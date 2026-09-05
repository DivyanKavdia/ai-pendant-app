/* Synap pendant power controls v2.
 * True deep sleep powers BLE off and can only be woken physically.
 * Remote standby keeps BLE available so the PWA can wake the pendant.
 */
(function(root){
  'use strict';
  const CONTROL_UUID='4fa12347-0000-1000-8000-00805f9b34fb';
  const PROTOCOL_VERSION=0x02;
  const CMD_GET_STATUS=0x02;
  const CMD_STANDBY=0x03;
  const CMD_WAKE=0x04;
  const POWER_EVENT_MAGIC=0xE2;
  const POWER_EVENT_VERSION=1;
  const POWER_STATE={AWAKE:1,STANDBY:2,DEEP_SLEEP:3};
  const STORAGE_KEY='synap-last-power-state-v1';
  let service=null,control=null,busy=false,lastState='unknown';

  function currentDeviceId(){
    return document.getElementById('setupDeviceId')?.dataset?.deviceId || '';
  }
  function save(state){
    lastState=state;
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({state,deviceId:currentDeviceId(),at:Date.now()}));}catch(_){}
  }
  function load(){
    try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch(_){return null;}
  }
  function setBodyState(state){
    lastState=state;
    if(document.body)document.body.dataset.synapPowerState=state;
    save(state);
    render();
  }
  function ensureUi(){
    const actions=document.querySelector('.pendant-actions');
    if(!actions||document.getElementById('powerStandbyButton'))return;
    const sleep=document.createElement('button');
    sleep.id='powerStandbyButton';sleep.type='button';sleep.className='button button-secondary';sleep.textContent='Standby';
    sleep.title='Low-power BLE standby. The app can wake the pendant.';
    const wake=document.createElement('button');
    wake.id='powerWakeButton';wake.type='button';wake.className='button button-primary';wake.textContent='Wake pendant';wake.hidden=true;
    const status=document.createElement('p');
    status.id='powerStateText';status.className='pendant-meta';status.setAttribute('role','status');
    actions.append(sleep,wake);actions.insertAdjacentElement('afterend',status);
    sleep.addEventListener('click',()=>sendPower(CMD_STANDBY));
    wake.addEventListener('click',()=>sendPower(CMD_WAKE));
  }
  function render(){
    ensureUi();
    const sleep=document.getElementById('powerStandbyButton');
    const wake=document.getElementById('powerWakeButton');
    const status=document.getElementById('powerStateText');
    const connected=Boolean(control&&service);
    const appState=document.body?.dataset?.state||'disconnected';
    const standby=lastState==='standby'||appState==='standby';
    const deep=lastState==='deep-sleep'||appState==='deep-sleep';
    if(sleep){sleep.hidden=standby||deep;sleep.disabled=!connected||busy||!['idle'].includes(appState);}
    if(wake){wake.hidden=!standby;wake.disabled=!connected||busy;}
    if(status){
      status.textContent=deep
        ? 'Deep sleep · tap the pendant once to wake'
        : standby
          ? 'Standby · Bluetooth is available for remote wake'
          : connected ? 'Awake' : 'Power state unavailable';
    }
    if(deep){
      const text=document.getElementById('connectionText');if(text)text.textContent='Deep sleep';
      const title=document.getElementById('recorderTitle');if(title)title.textContent='Pendant is sleeping.';
      const subtitle=document.getElementById('recorderSubtitle');if(subtitle)subtitle.textContent='Tap the pendant once to wake it.';
      const level=document.getElementById('levelText');if(level)level.textContent='Bluetooth off in deep sleep';
    }
  }
  async function write(characteristic,value){
    if(characteristic.properties?.write&&typeof characteristic.writeValueWithResponse==='function'){
      try{return await characteristic.writeValueWithResponse(value);}catch(error){
        if(error?.name!=='NotSupportedError')throw error;
      }
    }
    if(characteristic.properties?.writeWithoutResponse&&typeof characteristic.writeValueWithoutResponse==='function')return characteristic.writeValueWithoutResponse(value);
    return characteristic.writeValue(value);
  }
  async function sendPower(command){
    if(busy||!control)return;
    const appState=document.body?.dataset?.state||'';
    if(command===CMD_STANDBY&&appState!=='idle')return;
    busy=true;render();
    try{
      await write(control,new Uint8Array([command,PROTOCOL_VERSION]));
      await new Promise(resolve=>setTimeout(resolve,160));
      try{await write(control,new Uint8Array([CMD_GET_STATUS,PROTOCOL_VERSION]));}catch(_){}
    }catch(error){
      console.warn('[synap power] command failed',error);
      root.dispatchEvent(new CustomEvent('synap-power-error',{detail:{command,message:error?.message||String(error)}}));
    }finally{busy=false;render();}
  }
  function parseHex(hex){
    if(!hex)return[];
    return String(hex).trim().split(/\s+/).filter(Boolean).map(v=>parseInt(v,16));
  }
  function handleEventPacket(event){
    const b=parseHex(event?.detail?.hex);
    if(b.length<3||b[0]!==POWER_EVENT_MAGIC||b[1]!==POWER_EVENT_VERSION)return;
    if(b[2]===POWER_STATE.AWAKE)setBodyState('awake');
    if(b[2]===POWER_STATE.STANDBY)setBodyState('standby');
    if(b[2]===POWER_STATE.DEEP_SLEEP)setBodyState('deep-sleep');
  }
  async function attach(nextService){
    service=nextService||null;control=null;
    if(!service?.getCharacteristic){render();return false;}
    try{
      control=await service.getCharacteristic(CONTROL_UUID);
      const stored=load();
      if(stored?.state==='deep-sleep')setBodyState('awake');
      else {lastState='awake';document.body.dataset.synapPowerState='awake';save('awake');render();}
      return true;
    }catch(error){
      console.warn('[synap power] control attach failed',error);service=null;control=null;render();return false;
    }
  }
  function restoreLastKnown(){
    const stored=load();
    if(stored?.state==='deep-sleep'){
      lastState='deep-sleep';
      if(document.body)document.body.dataset.synapPowerState='deep-sleep';
      setTimeout(render,80);
    }
  }
  function bind(){ensureUi();restoreLastKnown();render();}
  root.addEventListener('synap-gatt-service-ready',event=>attach(event?.detail?.service||root.__synapGattService||null));
  root.addEventListener('synap-event-packet',handleEventPacket);
  root.addEventListener('synap-recording-foreground',render);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
  new MutationObserver(render).observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:['data-state','data-device-state']});
  root.SynapPowerControls={CMD_STANDBY,CMD_WAKE,POWER_STATE,get state(){return lastState},sendPower,attach};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})(globalThis);
