/* Robust battery BLE interception for browsers that expose Web Bluetooth constructors late or incompletely. */
(function(root){'use strict';
  if(root.__synapBatteryBleFix)return;root.__synapBatteryBleFix=true;
  const MAGIC=0xB7,VERSION=1;
  function inspectEvent(event){
    try{
      const v=event&&event.target&&event.target.value;
      if(!v||v.byteLength!==8||v.getUint8(0)!==MAGIC||v.getUint8(1)!==VERSION)return;
      if(root.SynapBatteryBridge&&typeof root.SynapBatteryBridge.inspect==='function')root.SynapBatteryBridge.inspect(event);
      const flags=v.getUint8(3),detail={percent:v.getUint8(2),available:Boolean(flags&1),low:Boolean(flags&2),critical:Boolean(flags&4),millivolts:v.getUint16(4,true),lowThresholdMv:v.getUint16(6,true)};
      console.info('[synap battery] BLE telemetry',detail);
    }catch(error){console.warn('[synap battery] telemetry parse failed',error);}
  }
  const proto=root.EventTarget&&root.EventTarget.prototype;
  if(proto&&!proto.__synapBatteryEventHook){
    const nativeAdd=proto.addEventListener;
    proto.addEventListener=function(type,listener,options){
      if(type==='characteristicvaluechanged'&&!this.__synapBatteryInspectBound){
        this.__synapBatteryInspectBound=true;
        nativeAdd.call(this,type,inspectEvent);
      }
      return nativeAdd.call(this,type,listener,options);
    };
    proto.__synapBatteryEventHook=true;
  }
  root.addEventListener('synap-battery-status',event=>{
    const d=event.detail||{};
    if(d.available)return;
    const button=document.getElementById('headerBatteryStatus');
    const pop=document.getElementById('synapBatteryPopover');
    if(button){button.dataset.state='unknown';button.setAttribute('aria-label','Pendant battery sensor unavailable');button.title='Pendant battery sensor unavailable';}
    if(pop){
      const state=pop.querySelector('.synap-battery-state'),status=pop.querySelector('[data-battery-status]'),voltage=pop.querySelector('[data-battery-voltage]'),updated=pop.querySelector('[data-battery-updated]');
      if(state)state.textContent='Sensor unavailable';
      if(status)status.textContent='Sensor unavailable';
      if(voltage)voltage.textContent=d.millivolts?((d.millivolts/1000).toFixed(2)+' V'):'No valid voltage';
      if(updated)updated.textContent='Just now';
    }
  });
})(globalThis);
