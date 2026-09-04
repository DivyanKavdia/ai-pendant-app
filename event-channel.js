/* Synap BLE asynchronous event transport.
   Captures the app-owned CONTROL characteristic at the moment app.js subscribes,
   so Bluefy/iOS receives the first battery packet deterministically. It then
   upgrades to the dedicated EVENT characteristic when that characteristic exists.
   The EventTarget hook is temporary and removed immediately after CONTROL capture. */
(function(root){'use strict';
const EVENT_UUID='4fa1234e-0000-1000-8000-00805f9b34fb';
const CONTROL_UUID='4fa12347-0000-1000-8000-00805f9b34fb';
const ACTIVE_STATES=new Set(['idle','starting','recording','stopping','saving','updating','connecting']);
let characteristic=null,controlHint=null,serviceHint=null,device=null,mode='none',attachTimer=0,attachEpoch=0;
let restoreAddEventListener=null;
function inspect(event){
  try{
    if(root.SynapMemoryEventBridge?.inspect)return root.SynapMemoryEventBridge.inspect(event);
    if(root.SynapBatteryBridge?.inspect)return root.SynapBatteryBridge.inspect(event);
  }catch(error){console.warn('[synap events] packet handling failed',error)}
}
function setMode(next){mode=next;document.body.dataset.eventChannel=next}
function removeControlTap(){
  if(controlHint){try{controlHint.removeEventListener('characteristicvaluechanged',inspect)}catch(_){}}
  controlHint=null;
}
function clear(){
  ++attachEpoch;
  if(attachTimer){clearTimeout(attachTimer);attachTimer=0}
  if(characteristic){try{characteristic.removeEventListener('characteristicvaluechanged',inspect)}catch(_){}}
  removeControlTap();
  characteristic=null;serviceHint=null;device=null;setMode('none');
}
function captureControl(characteristicTarget,nativeAdd){
  if(!characteristicTarget||controlHint===characteristicTarget)return;
  const uuid=String(characteristicTarget.uuid||'').toLowerCase();
  if(uuid!==CONTROL_UUID)return;
  controlHint=characteristicTarget;
  serviceHint=characteristicTarget.service||serviceHint;
  device=serviceHint?.device||device;
  try{nativeAdd.call(characteristicTarget,'characteristicvaluechanged',inspect)}catch(error){console.warn('[synap events] control tap failed',error)}
  setMode('legacy-control-captured');
  console.info('[synap events] captured app CONTROL channel');
  if(restoreAddEventListener){restoreAddEventListener();restoreAddEventListener=null}
  schedule(0);
}
function installTemporaryControlCapture(){
  const proto=root.EventTarget?.prototype;
  if(!proto||typeof proto.addEventListener!=='function'||proto.__synapControlCapture)return;
  const nativeAdd=proto.addEventListener;
  const wrapper=function(type,listener,options){
    const result=nativeAdd.call(this,type,listener,options);
    if(type==='characteristicvaluechanged'){
      try{captureControl(this,nativeAdd)}catch(error){console.warn('[synap events] characteristic capture failed',error)}
    }
    return result;
  };
  proto.addEventListener=wrapper;
  proto.__synapControlCapture=true;
  restoreAddEventListener=function(){
    if(proto.addEventListener===wrapper)proto.addEventListener=nativeAdd;
    try{delete proto.__synapControlCapture}catch(_){proto.__synapControlCapture=false}
  };
}
async function attachDedicatedEvent(){
  if(!serviceHint?.getCharacteristic)return false;
  const epoch=++attachEpoch;
  try{
    const next=await serviceHint.getCharacteristic(EVENT_UUID);
    if(epoch!==attachEpoch||!next)return false;
    if(characteristic===next&&mode==='event')return true;
    if(characteristic)try{characteristic.removeEventListener('characteristicvaluechanged',inspect)}catch(_){}
    characteristic=next;
    characteristic.addEventListener('characteristicvaluechanged',inspect);
    await characteristic.startNotifications();
    if(epoch!==attachEpoch)return false;
    setMode('event');
    // EVENT is READ|NOTIFY. Read the retained latest packet so reconnects do not
    // depend on waiting for the next 15-second battery telemetry publish.
    try{
      const value=await characteristic.readValue();
      if(value?.byteLength)inspect({target:{value}});
    }catch(error){console.warn('[synap events] initial EVENT read failed',error)}
    removeControlTap();
    root.dispatchEvent(new CustomEvent('synap-event-channel-ready',{detail:{mode:'event'}}));
    console.info('[synap events] upgraded to dedicated EVENT channel');
    return true;
  }catch(error){
    // Firmware before build 1081 has no EVENT characteristic. CONTROL tap remains.
    if(error?.name!=='NotFoundError')console.warn('[synap events] EVENT attach failed',error);
    return false;
  }
}
async function attach(){
  const state=document.body?.dataset?.state||'';
  if(!ACTIVE_STATES.has(state))return false;
  if(serviceHint)return attachDedicatedEvent();
  return false;
}
function schedule(delay=80){
  if(attachTimer)clearTimeout(attachTimer);
  attachTimer=setTimeout(()=>{attachTimer=0;attach()},delay);
}
function observeState(){
  const body=document.body;if(!body)return;
  new MutationObserver(()=>{
    const state=body.dataset.state||'';
    if(ACTIVE_STATES.has(state)&&serviceHint&&mode!=='event')schedule(60);
  }).observe(body,{attributes:true,attributeFilter:['data-state']});
}
installTemporaryControlCapture();
document.addEventListener('DOMContentLoaded',observeState,{once:true});
if(document.readyState!=='loading')observeState();
root.addEventListener('synap-recording-foreground',()=>{if(serviceHint&&mode!=='event')schedule(60)});
root.SynapEventChannel={EVENT_UUID,CONTROL_UUID,get mode(){return mode},attach,reset:clear};
})(globalThis);
