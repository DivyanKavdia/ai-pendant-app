/* Synap BLE asynchronous event transport.
   Prefers the dedicated EVENT characteristic and falls back to CONTROL only for
   firmware that predates the event channel. No global EventTarget interception. */
(function(root){'use strict';
const SERVICE_UUID='4fa12345-0000-1000-8000-00805f9b34fb';
const EVENT_UUID='4fa1234e-0000-1000-8000-00805f9b34fb';
const CONTROL_UUID='4fa12347-0000-1000-8000-00805f9b34fb';
const ACTIVE_STATES=new Set(['idle','starting','recording','stopping','saving','updating']);
let characteristic=null,device=null,mode='none',attachTimer=0,attachEpoch=0;
function inspect(event){
  try{
    if(root.SynapMemoryEventBridge?.inspect)return root.SynapMemoryEventBridge.inspect(event);
    if(root.SynapBatteryBridge?.inspect)return root.SynapBatteryBridge.inspect(event);
  }catch(error){console.warn('[synap events] packet handling failed',error)}
}
function clear(){
  ++attachEpoch;
  if(attachTimer){clearTimeout(attachTimer);attachTimer=0}
  if(characteristic){try{characteristic.removeEventListener('characteristicvaluechanged',inspect)}catch(_){}}
  characteristic=null;device=null;mode='none';
  document.body.dataset.eventChannel='none';
}
async function connectedDevice(){
  if(!navigator.bluetooth?.getDevices)return null;
  const devices=await navigator.bluetooth.getDevices();
  const connected=devices.filter(item=>item.gatt?.connected);
  if(!connected.length)return null;
  return connected[0];
}
async function resolveCharacteristic(service){
  try{return{characteristic:await service.getCharacteristic(EVENT_UUID),mode:'event'}}
  catch(error){
    if(error?.name!=='NotFoundError')console.warn('[synap events] EVENT characteristic unavailable',error);
    try{return{characteristic:await service.getCharacteristic(CONTROL_UUID),mode:'legacy-control'}}
    catch(_){return null}
  }
}
async function attach(){
  const epoch=++attachEpoch,state=document.body?.dataset?.state||'';
  if(!ACTIVE_STATES.has(state)){clear();return}
  try{
    const next=await connectedDevice();
    if(epoch!==attachEpoch||!next?.gatt?.connected)return;
    if(device===next&&characteristic)return;
    const service=await next.gatt.getPrimaryService(SERVICE_UUID);
    if(epoch!==attachEpoch||!next.gatt.connected)return;
    const resolved=await resolveCharacteristic(service);
    if(epoch!==attachEpoch||!resolved?.characteristic||!next.gatt.connected)return;
    if(characteristic)try{characteristic.removeEventListener('characteristicvaluechanged',inspect)}catch(_){}
    device=next;characteristic=resolved.characteristic;mode=resolved.mode;
    characteristic.addEventListener('characteristicvaluechanged',inspect);
    await characteristic.startNotifications();
    if(epoch!==attachEpoch)return;
    document.body.dataset.eventChannel=mode;
    // EVENT is READ|NOTIFY on new firmware. Reading gives the most recent event so
    // battery UI does not wait for the next 15-second telemetry cycle after attach.
    if(mode==='event'&&characteristic.properties?.read){
      try{const value=await characteristic.readValue();if(value?.byteLength)inspect({target:{value}})}catch(_){}
    }
    root.dispatchEvent(new CustomEvent('synap-event-channel-ready',{detail:{mode}}));
    console.info('[synap events] subscribed via '+mode);
  }catch(error){
    if(epoch!==attachEpoch)return;
    console.warn('[synap events] attach failed',error);
    document.body.dataset.eventChannel='unavailable';
  }
}
function schedule(delay=450){
  if(attachTimer)clearTimeout(attachTimer);
  attachTimer=setTimeout(()=>{attachTimer=0;attach()},delay);
}
function observeState(){
  const body=document.body;if(!body)return;
  new MutationObserver(()=>{
    const state=body.dataset.state||'';
    if(ACTIVE_STATES.has(state))schedule();else clear();
  }).observe(body,{attributes:true,attributeFilter:['data-state']});
  if(ACTIVE_STATES.has(body.dataset.state||''))schedule(700);
}
document.addEventListener('DOMContentLoaded',observeState,{once:true});
if(document.readyState!=='loading')observeState();
root.addEventListener('pageshow',()=>schedule(700));
root.addEventListener('synap-recording-foreground',()=>schedule(250));
root.SynapEventChannel={EVENT_UUID,CONTROL_UUID,get mode(){return mode},attach,reset:clear};
})(globalThis);
