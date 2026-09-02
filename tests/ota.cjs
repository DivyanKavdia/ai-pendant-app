// node tests/ota.cjs — mock BLE transport; no dependencies or physical device.
const assert=require('node:assert/strict');
const cryptoNode=require('node:crypto');
const {Client,decode,validateImage}=require('../ota.js');
function image(size=512) {
  const bytes=new Uint8Array(size);bytes[0]=0xE9;bytes[12]=9;
  new DataView(bytes.buffer).setUint32(32,0xABCD5432,true);
  bytes.set(new TextEncoder().encode('SYNAP-ESP32S3-OTA-V1'),40);
  return {bytes,size,arrayBuffer:async()=>bytes.buffer};
}
function mock(options={}) {
  let connected=true,listener=null,revision=501;
  const state={state:options.state??2,error:0,session:0,offset:0,capacity:2048,maxData:173};
  const chunks=[],commands=[],progress=[];let hash=null,length=0;
  function status() {
    const b=new Uint8Array(20),v=new DataView(b.buffer);b[0]=0xD7;b[1]=1;b[2]=state.state;b[3]=state.error;
    v.setUint32(4,state.session,true);v.setUint32(8,state.offset,true);v.setUint32(12,state.capacity,true);
    v.setUint16(16,state.maxData,true);v.setUint16(18,revision,true);return v;
  }
  const characteristic={addEventListener:(t,f)=>listener=f,removeEventListener:()=>listener=null,
    startNotifications:async()=>{},readValue:async()=>status()};
  const write={writeValueWithResponse:async bytes=>{
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const cmd=bytes[0];commands.push(cmd);
    if(cmd===1) {state.session=v.getUint32(1,true);length=v.getUint32(5,true);hash=bytes.slice(9);state.state=3;}
    if(cmd===2) {
      assert.equal(v.getUint32(5,true),state.offset,'strict FIFO offset');
      chunks.push(bytes.slice(9));state.offset+=bytes.length-9;
      if(options.drop) {connected=false;client.reset();throw new Error('link lost');}
      if(options.chunkFailure) {state.error=5;state.state=6;}
      if(options.cancel) client.cancel();
    }
    if(cmd===3) {
      assert.equal(state.offset,length);
      assert.equal(Buffer.from(hash).toString('hex'),cryptoNode.createHash('sha256').update(Buffer.concat(chunks)).digest('hex'));
      state.state=options.hashFailure?6:4;state.error=options.hashFailure?7:0;
    }
    if(cmd===4) {assert.equal(state.state,4,'commit only after validation');state.state=5;
      if(options.commitDrop) {connected=false;client.reset();throw new Error('reboot');}}
    if(cmd===5) {state.state=6;state.error=10;}
    if(listener && !options.noNotifications) listener({target:{value:status()}});
  }};
  const client=new Client({connected:()=>connected,queue:async f=>f(),progress:(...p)=>progress.push(p),
    getService:async()=>({getCharacteristic:async uuid=>{
      if(options.legacy) {const error=new Error('missing');error.name='NotFoundError';throw error;}
      return uuid.includes('12348')?write:characteristic;
    }})});
  return {client,state,commands,chunks,progress,disconnect:()=>{connected=false;client.reset();}};
}
(async()=>{
  assert.throws(()=>decode(new DataView(new ArrayBuffer(2))),/protocol/);
  validateImage(image().bytes,2048);
  for(const index of [0,12,32,40]) {const f=image();f.bytes[index]^=1;assert.throws(()=>validateImage(f.bytes,2048));}
  assert.throws(()=>validateImage(image().bytes,100),/slot/);
  let t=mock();const info=await t.client.check();assert.equal(info.build,501);
  const result=await t.client.update(image());assert.equal(result.committed,true);assert.equal(t.client.busy,false);
  assert.deepEqual(t.commands,[1,2,2,2,3,4]);assert.equal(Buffer.concat(t.chunks).length,512);
  assert.equal(t.progress.at(-1)[2],true,'cancel disabled at commit');
  t=mock({state:1});await t.client.check();await assert.rejects(t.client.update(image()),/BOOT/);assert.equal(t.commands.length,0);
  t=mock({legacy:true});await assert.rejects(t.client.check(),/USB/);
  for(const options of [{drop:true},{chunkFailure:true},{hashFailure:true},{cancel:true}]) {
    t=mock(options);await t.client.check();await assert.rejects(t.client.update(image()));
    assert(!t.commands.includes(4),'failure never commits');assert.equal(t.client.busy,false);
    if(!options.drop) assert(t.commands.includes(5),'best-effort cancellation');
  }
  t=mock({commitDrop:true});await t.client.check();await assert.rejects(t.client.update(image()),/confirmation is incomplete/);
  assert(!t.commands.includes(5),'never claim abort after commit');
  t=mock({noNotifications:true});await t.client.check();assert.equal((await t.client.update(image(80))).committed,true,'read fallback when notifications lost');
  t=mock();await t.client.check();const bad=image();bad.bytes[0]=0;
  await assert.rejects(t.client.update(bad),/application/);assert.equal(t.commands.length,0);
  t=mock();await t.client.check();t.disconnect();await assert.rejects(t.client.update(image()),/interrupted/);
  console.log('PASS: image/marker validation, discovery, legacy firmware, ordered bytes and SHA-256, notification read fallback, failures, cancellation and uncertain commit.');
})().catch(error=>{console.error(error);process.exitCode=1;});
