/* Reliable one-tap PWA Remember This handler. Hardware Remember This remains a long press on TTP223. */
(function(root){'use strict';
const HKEY='synap-memory-highlights',DB='dk-pendant-recordings';
/* Install the battery BLE interceptor synchronously while this parser-inserted head script runs.
   Dynamic script injection was racy on mobile browsers and could miss all later 0xB7 notifications. */
(function installBatteryBleHook(){
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
})();
function read(){try{return JSON.parse(localStorage.getItem(HKEY)||'[]')}catch(_){return[]}}
function write(v){try{localStorage.setItem(HKEY,JSON.stringify(v.slice(-500)))}catch(_){}}
function timerSeconds(){const t=document.getElementById('timer')?.textContent||'';const p=t.split(':').map(Number);if(p.some(Number.isNaN))return null;return p.length===2?p[0]*60+p[1]:p.length===3?p[0]*3600+p[1]*60+p[2]:null}
function latest(){return new Promise(resolve=>{try{const q=indexedDB.open(DB);q.onerror=()=>resolve(null);q.onsuccess=()=>{const db=q.result;try{const r=db.transaction('recordings').objectStore('recordings').getAll();r.onerror=()=>{db.close();resolve(null)};r.onsuccess=()=>{const list=(r.result||[]).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));db.close();resolve(list.find(x=>x.status==='recording'||x.state==='recording')||list[0]||null)}}catch(_){db.close();resolve(null)}}}catch(_){resolve(null)}})}
async function mark(button){const state=document.body.dataset.state||'',active=['recording','starting'].includes(state),rec=await latest(),hs=read(),now=Date.now();const h={id:root.crypto?.randomUUID?.()||String(now),createdAt:new Date(now).toISOString(),recordingId:rec?.id||null,offsetSeconds:active?timerSeconds():null,source:active?'live-capture':'manual'};hs.push(h);write(hs);if(button){const old=button.textContent;button.textContent='✓ Remembered';button.classList.add('remembered');button.disabled=true;setTimeout(()=>{button.textContent=old;button.classList.remove('remembered');button.disabled=false},1200)}root.dispatchEvent(new CustomEvent('synap-memory-highlight',{detail:h}))}
document.addEventListener('click',e=>{const b=e.target?.closest?.('#rememberThis');if(!b)return;e.preventDefault();e.stopImmediatePropagation();mark(b)},{capture:true});
})(globalThis);
