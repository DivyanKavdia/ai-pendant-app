/* Synap BLE OTA protocol 1. No framework, server upload or stored firmware. */
(function (root) {
  "use strict";
  const WRITE_UUID = "4fa12348-0000-1000-8000-00805f9b34fb";
  const STATUS_UUID = "4fa12349-0000-1000-8000-00805f9b34fb";
  const errors = ["", "Hold BOOT for 2 seconds and release to unlock updates.", "Invalid OTA packet.",
    "Firmware does not fit the inactive slot.", "Chunk order or duplicate mismatch.", "Flash operation failed.",
    "Not a compatible Synap ESP32-S3 application image.", "SHA-256 verification failed.",
    "Bluetooth connection changed.", "Update timed out.", "Update cancelled.", "Stop recording first."];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function decode(value) {
    if (!value || value.byteLength !== 20 || value.getUint8(0) !== 0xD7 || value.getUint8(1) !== 1) {
      throw new Error("Unsupported OTA status/protocol.");
    }
    return {state:value.getUint8(2), error:value.getUint8(3), session:value.getUint32(4,true),
      offset:value.getUint32(8,true), capacity:value.getUint32(12,true),
      maxData:value.getUint16(16,true), build:value.getUint16(18,true)};
  }
  function packet(command, session, size = 5) {
    const data = new Uint8Array(size);data[0]=command;
    new DataView(data.buffer).setUint32(1,session,true);return data;
  }
  function validateImage(bytes, capacity) {
    if (bytes.length < 36 || bytes.length > capacity || bytes.length > 16*1024*1024) {
      throw new Error("Application .bin is empty or exceeds the available OTA slot.");
    }
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if (bytes[0] !== 0xE9 || view.getUint16(12,true) !== 9 || view.getUint32(32,true) !== 0xABCD5432) {
      throw new Error("Select the ESP32-S3 application .bin, not a merged, bootloader or partition image.");
    }
    const marker = new TextEncoder().encode("SYNAP-ESP32S3-OTA-V1");
    let match = 0;
    for (const byte of bytes) {
      match = byte === marker[match] ? match+1 : (byte === marker[0] ? 1 : 0);
      if (match === marker.length) return;
    }
    throw new Error("This firmware lacks the Synap OTA compatibility marker. Use a trusted Synap build.");
  }
  class Client {
    constructor(io) { this.io=io;this.epoch=0;this.busy=false;this.committing=false;this.cancelled=false; }
    reset() {
      ++this.epoch;
      if (this.statusChar && this.listener) this.statusChar.removeEventListener("characteristicvaluechanged",this.listener);
      this.statusChar=this.writeChar=null;this.status=null;
    }
    async check() {
      if (this.busy) throw new Error("An update is already running.");
      this.reset();const epoch=this.epoch;
      try {
        const service=await this.io.getService();
        const write=await this.io.queue(()=>service.getCharacteristic(WRITE_UUID),"Find firmware updater");
        const status=await this.io.queue(()=>service.getCharacteristic(STATUS_UUID),"Find firmware status");
        if (epoch!==this.epoch) throw new Error("Pendant connection changed.");
        this.writeChar=write;this.statusChar=status;
        this.listener=event=>{ try { if(epoch===this.epoch) this.status=decode(event.target.value); } catch (_) {} };
        status.addEventListener("characteristicvaluechanged",this.listener);
        await this.io.queue(()=>status.startNotifications(),"Subscribe to firmware progress");
        return await this.read();
      } catch (error) {
        this.reset();
        if (error.name === "NotFoundError") throw new Error("This pendant needs its first OTA-enabled firmware installed by USB.");
        throw error;
      }
    }
    async read() {
      const epoch=this.epoch,characteristic=this.statusChar;
      if (!characteristic) throw new Error("Check the connected pendant first.");
      const value=await this.io.queue(()=>characteristic.readValue(),"Read firmware status");
      if(epoch!==this.epoch) throw new Error("Pendant connection changed.");
      return (this.status=decode(value));
    }
    cancel() { if (!this.committing) this.cancelled=true; }
    ensure(epoch) {
      if (epoch!==this.epoch || !this.io.connected()) throw new Error("BLE interrupted. Reconnect and restart the transfer from zero.");
      if (this.cancelled) throw new Error("Update cancelled.");
    }
    async send(data, epoch) {
      this.ensure(epoch);const characteristic=this.writeChar;
      await this.io.queue(()=>characteristic.writeValueWithResponse(data),"Write firmware packet");
    }
    async ack(predicate, epoch, session, timeout=15000) {
      const end=Date.now()+timeout;let nextRead=Date.now()+500;
      while(Date.now()<end) {
        this.ensure(epoch);
        const s=this.status;
        if (s && s.error && (s.session===session || s.state===1 || s.state===2)) throw new Error(errors[s.error] || "Firmware update failed.");
        if (s && s.session===session && predicate(s)) return s;
        if(Date.now()>=nextRead) { await this.read();nextRead=Date.now()+500; }
        else await sleep(15);
      }
      throw new Error("Firmware acknowledgement timed out. Reconnect and restart from zero.");
    }
    async update(file) {
      if (this.busy) throw new Error("An update is already running.");
      this.busy=true;this.cancelled=false;this.committing=false;
      const epoch=this.epoch;let session=0,begun=false;
      try {
        this.ensure(epoch);
        const info=await this.read();
        if (info.state!==2) throw new Error(info.state===0 ? "OTA needs two application slots and a sufficient BLE MTU." : "Hold BOOT for 2 seconds and release, then try Update again.");
        if (info.maxData<36 || info.maxData>173) throw new Error("Unsupported BLE firmware packet size.");
        if (!file || file.size<36 || file.size>info.capacity || file.size>16*1024*1024) throw new Error("Choose an application .bin that fits the available slot.");
        this.io.progress("Checking firmware…",0,false);
        const bytes=new Uint8Array(await file.arrayBuffer());validateImage(bytes,info.capacity);
        const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
        this.ensure(epoch);
        session=crypto.getRandomValues(new Uint32Array(1))[0] || 1;
        const begin=packet(1,session,41);new DataView(begin.buffer).setUint32(5,bytes.length,true);begin.set(digest,9);
        begun=true;await this.send(begin,epoch);
        await this.ack(s=>s.state===3 && s.offset===0,epoch,session,30000);
        for(let offset=0;offset<bytes.length;) {
          const count=Math.min(info.maxData,bytes.length-offset);
          const chunk=packet(2,session,9+count);new DataView(chunk.buffer).setUint32(5,offset,true);
          chunk.set(bytes.subarray(offset,offset+count),9);
          await this.send(chunk,epoch);
          await this.ack(s=>s.state===3 && s.offset===offset+count,epoch,session);
          offset+=count;
          this.io.progress("Sending firmware · "+Math.floor(offset*100/bytes.length)+"%",offset/bytes.length,false);
        }
        this.io.progress("Verifying firmware on pendant…",1,false);
        await this.send(packet(3,session),epoch);await this.ack(s=>s.state===4,epoch,session,30000);
        this.ensure(epoch);this.committing=true;
        this.io.progress("Verified · selecting firmware and rebooting…",1,true);
        await this.send(packet(4,session),epoch);await this.ack(s=>s.state===5,epoch,session,10000);
        return {committed:true,sha256:Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("")};
      } catch(error) {
        if (this.committing) throw new Error("Commit was sent, but reboot confirmation is incomplete. Reconnect and Check pendant before attempting another update. "+error.message);
        if (begun && epoch===this.epoch && this.io.connected() && this.writeChar) {
          const characteristic=this.writeChar;
          try { await this.io.queue(()=>characteristic.writeValueWithResponse(packet(5,session)),"Cancel firmware transfer"); } catch (_) {}
        }
        throw error;
      } finally { this.busy=false; }
    }
  }
  root.SynapOTA={Client,decode,packet,validateImage};
  if(typeof module!=="undefined" && module.exports) module.exports=root.SynapOTA;
})(globalThis);
