/* Synap BLE asynchronous event transport.
   Prefers the dedicated EVENT characteristic and falls back to CONTROL only for
   firmware that predates the event channel. The main app-owned GATT service is
   captured directly so Bluefy/iOS does not depend on navigator.bluetooth.getDevices(). */
(function(root){'use strict';
const SERVICE_UUID='4fa12345-0000-1000-8000-00805f9b34fb';
const EVENT_UUID='4fa1234e-0000-1000-8000-00805f9b34fb';
const CONTROL_UUID='4fa12347-0000-1000-8000-00805f9b34fb';
const ACTIVE_STATES=new Set(['idle','starting','recording','stopping','saving','updating']);
let characteristic=null,device=null,serviceHint=null,mode='none',attachTimer=0,attachEpoch=0;
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
  if(serviceHint?.device?.gatt&&!serviceHint.device.gatt.connected)serviceHint=null;
  document.body.dataset.eventChannel='none';
}
function installServiceCapture(){
  const proto=root.BluetoothRemoteGATTServer?.prototype;
  if(!proto||proto.__synapServiceCapture||typeof proto.getPrimaryService!=='function')return;
  const native=proto.getPrimaryService;
  proto.getPrimaryService=async function(uuid){
    const service=await native.call(this,uuid);
    try{
      if(String(uuid).toLowerCase()===SERVICE_UUID){
        serviceHint=service;
        if(ACTIVE_STATES.has(document.body?.dataset?.state||''))schedule(80);
      }
    }catch(_){}
    return service;
  };
  proto.__synapServiceCapture=true;
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
async function resolveService(){
  if(serviceHint?.device?.gatt?.connected)return{service:serviceHint,device:serviceHint.device};
  const next=await connectedDevice();
  if(!next?.gatt?.connected)return null;
  return{service:await next.gatt.getPrimaryService(SERVICE_UUID),device:next};
}
async function attach(){
  const epoch=++attachEpoch,state=document.body?.dataset?.state||'';
  if(!ACTIVE_STATES.has(state)){clear();return}
  try{
    const target=await resolveService();
    if(epoch!==attachEpoch||!target?.device?.gatt?.connected)return;
    if(device===target.device&&characteristic)return;
    const resolved=await resolveCharacteristic(target.service);
    if(epoch!==attachEpoch||!resolved?.characteristic||!target.device.gatt.connected)return;
    if(characteristic)try{characteristic.removeEventListener('characteristicvaluechanged',inspect)}catch(_){}
    device=target.device;serviceHint=target.service;characteristic=resolved.characteristic;mode=resolved.mode;
    characteristic.addEventListener('characteristicvaluechanged',inspect);
    await characteristic.startNotifications();
    if(epoch!==attachEpoch)return;
    document.body.dataset.eventChannel=mode;
    // EVENT is READ|NOTIFY on new firmware. Reading gives the most recent event so
    // battery UI does not wait for the next telemetry cycle after attach.
    if(mode==='event'&&characteristic.properties?.read){
      try{const value=await characteristic.readValue();if(value?.byteLength)inspect({target:{value}})}catch(error){console.warn('[synap events] initial EVENT read failed',error)}
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
    if(ACTIVE_STATES.has(state))schedule(120);else clear();
  }).observe(body,{attributes:true,attributeFilter:['data-state']});
  if(ACTIVE_STATES.has(body.dataset.state||''))schedule(350);
}
installServiceCapture();
document.addEventListener('DOMContentLoaded',observeState,{once:true});
if(document.readyState!=='loading')observeState();
root.addEventListener('pageshow',()=>schedule(350));
root.addEventListener('synap-recording-foreground',()=>schedule(150));
root.SynapEventChannel={EVENT_UUID,CONTROL_UUID,get mode(){return mode},attach,reset:clear};
})(globalThis);
