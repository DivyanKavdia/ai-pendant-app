/* Synap BLE asynchronous event transport.
   Binds to the exact live GATT service handed off by device-identity.js.
   This path does not depend on browser device rediscovery or prototype interception
   and is therefore Bluefy/iOS friendly. */
(function(root){'use strict';
const EVENT_UUID='4fa1234e-0000-1000-8000-00805f9b34fb';
const CONTROL_UUID='4fa12347-0000-1000-8000-00805f9b34fb';
let characteristic=null,serviceHint=root.__synapGattService||null,mode='none',attachTimer=0,attachEpoch=0,lastPacket=null;
function packetBytes(value){try{return Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength)).map(b=>b.toString(16).padStart(2,'0')).join(' ')}catch(_){return''}}
function inspect(event,source){
  try{
    const value=event?.target?.value;
    if(value){lastPacket={source,bytes:value.byteLength,hex:packetBytes(value),at:Date.now()};root.dispatchEvent(new CustomEvent('synap-event-packet',{detail:lastPacket}))}
    if(root.SynapMemoryEventBridge?.inspect)return root.SynapMemoryEventBridge.inspect(event);
    if(root.SynapBatteryBridge?.inspect)return root.SynapBatteryBridge.inspect(event);
  }catch(error){console.warn('[synap events] packet handling failed',error)}
}
function setMode(next){mode=next;if(document.body)document.body.dataset.eventChannel=next}
function clear(){
  ++attachEpoch;
  if(attachTimer){clearTimeout(attachTimer);attachTimer=0}
  if(characteristic){try{characteristic.removeEventListener('characteristicvaluechanged',handleEvent)}catch(_){}}
  characteristic=null;setMode('none');
}
function handleEvent(event){inspect(event,'event')}
async function attachDedicatedEvent(){
  if(!serviceHint?.getCharacteristic)return false;
  const epoch=++attachEpoch;
  try{
    const next=await serviceHint.getCharacteristic(EVENT_UUID);
    if(epoch!==attachEpoch||!next)return false;
    if(characteristic===next&&mode==='event')return true;
    if(characteristic)try{characteristic.removeEventListener('characteristicvaluechanged',handleEvent)}catch(_){}
    characteristic=next;
    characteristic.addEventListener('characteristicvaluechanged',handleEvent);
    await characteristic.startNotifications();
    if(epoch!==attachEpoch)return false;
    setMode('event');
    root.dispatchEvent(new CustomEvent('synap-event-channel-ready',{detail:{mode:'event'}}));
    console.info('[synap events] subscribed via explicit app GATT service');
    try{
      const value=await characteristic.readValue();
      if(value?.byteLength)inspect({target:{value}},'event-read');
    }catch(error){console.warn('[synap events] retained EVENT read failed',error)}
    return true;
  }catch(error){
    setMode(error?.name==='NotFoundError'?'legacy-control':'unavailable');
    if(error?.name!=='NotFoundError')console.warn('[synap events] EVENT attach failed',error);
    return false;
  }
}
function schedule(delay=500){
  if(attachTimer)clearTimeout(attachTimer);
  attachTimer=setTimeout(()=>{attachTimer=0;attachDedicatedEvent()},delay);
}
root.addEventListener('synap-gatt-service-ready',event=>{
  serviceHint=event?.detail?.service||root.__synapGattService||null;
  setMode('service-ready');
  schedule(700);
  setTimeout(()=>{if(mode!=='event')schedule(0)},1600);
});
root.addEventListener('synap-recording-foreground',()=>{if(serviceHint&&mode!=='event')schedule(150)});
if(serviceHint)schedule(900);
root.SynapEventChannel={EVENT_UUID,CONTROL_UUID,get mode(){return mode},get lastPacket(){return lastPacket},attach:attachDedicatedEvent,reset:clear};
})(globalThis);
