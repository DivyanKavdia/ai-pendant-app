(function(){
'use strict';
const AUDIO_UUID='4fa12346-0000-1000-8000-00805f9b34fb';
const CONTROL_UUID='4fa12347-0000-1000-8000-00805f9b34fb';
const AUDIO_MAGIC=0xA5, STATUS_MAGIC=0x5A, PROTOCOL_VERSION=2;
const PCM_BYTES_PER_FRAME=1600, LEGACY_CHUNKS=10, LEGACY_PAYLOAD=160, AUDIO_HEADER_BYTES=8;

// Bluefy/iOS may not expose Web Locks. The app's storage layer remains single-page
// safe without it, so provide the minimum exclusive-lock contract expected by app.js
// instead of aborting startup before any button handlers are bound.
if(!navigator.locks){
  const locks={
    async request(name,options,callback){
      if(typeof options==='function'){callback=options;options={};}
      return callback({name:String(name||''),mode:'exclusive'});
    }
  };
  try{Object.defineProperty(navigator,'locks',{value:locks,configurable:true});}
  catch(_){try{navigator.locks=locks;}catch(__){}}
  document.documentElement.dataset.synapLockFallback='1';
}

const NativeEventTarget=globalThis.EventTarget;
if(!NativeEventTarget||!NativeEventTarget.prototype)return;
const nativeAdd=NativeEventTarget.prototype.addEventListener;
const nativeRemove=NativeEventTarget.prototype.removeEventListener;
const listenerMaps=new WeakMap();
const frameMaps=new WeakMap();

function uuidOf(target){return String(target&&target.uuid||'').toLowerCase();}
function callListener(listener,context,event){
  if(typeof listener==='function')return listener.call(context,event);
  return listener&&typeof listener.handleEvent==='function' ? listener.handleEvent(event) : undefined;
}
function syntheticEvent(value,real){
  return {target:{value},currentTarget:real&&real.currentTarget||null,type:'characteristicvaluechanged'};
}
function viewCopy(view){
  const out=new Uint8Array(view.byteLength);out.set(new Uint8Array(view.buffer,view.byteOffset,view.byteLength));return out;
}
function audioWrapper(listener){
  return function(event){
    const target=event&&event.target;
    if(uuidOf(target)!==AUDIO_UUID)return callListener(listener,this,event);
    const v=target&&target.value;
    if(!v||v.byteLength<AUDIO_HEADER_BYTES||v.getUint8(0)!==AUDIO_MAGIC||v.getUint8(1)!==PROTOCOL_VERSION)
      return callListener(listener,this,event);
    const total=v.getUint8(5),payload=v.getUint16(6,true);
    if(total>=LEGACY_CHUNKS&&payload<=LEGACY_PAYLOAD)return callListener(listener,this,event);
    const seq=v.getUint16(2,true),idx=v.getUint8(4);
    if(!total||idx>=total||payload===0||AUDIO_HEADER_BYTES+payload!==v.byteLength)return callListener(listener,this,event);
    let frames=frameMaps.get(target);if(!frames){frames=new Map();frameMaps.set(target,frames);}
    let frame=frames.get(seq);
    if(!frame||frame.total!==total){frame={total,chunks:new Array(total),count:0};frames.set(seq,frame);}
    if(!frame.chunks[idx]){
      frame.chunks[idx]=viewCopy(new DataView(v.buffer,v.byteOffset+AUDIO_HEADER_BYTES,payload));
      frame.count++;
    }
    if(frame.count!==frame.total)return;
    frames.delete(seq);
    const pcm=new Uint8Array(PCM_BYTES_PER_FRAME);let offset=0;
    for(let i=0;i<frame.total;i++){
      const chunk=frame.chunks[i];if(!chunk||offset+chunk.length>pcm.length)return callListener(listener,this,event);
      pcm.set(chunk,offset);offset+=chunk.length;
    }
    if(offset!==PCM_BYTES_PER_FRAME)return callListener(listener,this,event);
    for(let i=0;i<LEGACY_CHUNKS;i++){
      const packet=new Uint8Array(AUDIO_HEADER_BYTES+LEGACY_PAYLOAD);
      packet[0]=AUDIO_MAGIC;packet[1]=PROTOCOL_VERSION;packet[2]=seq&255;packet[3]=seq>>8;
      packet[4]=i;packet[5]=LEGACY_CHUNKS;packet[6]=LEGACY_PAYLOAD&255;packet[7]=LEGACY_PAYLOAD>>8;
      packet.set(pcm.subarray(i*LEGACY_PAYLOAD,(i+1)*LEGACY_PAYLOAD),AUDIO_HEADER_BYTES);
      callListener(listener,this,syntheticEvent(new DataView(packet.buffer),event));
    }
  };
}
function controlWrapper(listener){
  return function(event){
    const target=event&&event.target;
    if(uuidOf(target)!==CONTROL_UUID)return callListener(listener,this,event);
    const v=target&&target.value;
    if(!v||v.byteLength!==16||v.getUint8(0)!==STATUS_MAGIC||v.getUint8(1)!==PROTOCOL_VERSION)
      return callListener(listener,this,event);
    const chunks=v.getUint8(8),payload=v.getUint16(14,true);
    if(v.getUint8(2)!==2||(chunks>=10&&payload<=160))return callListener(listener,this,event);
    const copy=viewCopy(v);copy[8]=LEGACY_CHUNKS;copy[14]=LEGACY_PAYLOAD&255;copy[15]=LEGACY_PAYLOAD>>8;
    return callListener(listener,this,syntheticEvent(new DataView(copy.buffer),event));
  };
}

NativeEventTarget.prototype.addEventListener=function(type,listener,options){
  if(type!=='characteristicvaluechanged'||!listener)return nativeAdd.call(this,type,listener,options);
  const uuid=uuidOf(this);
  if(uuid!==AUDIO_UUID&&uuid!==CONTROL_UUID)return nativeAdd.call(this,type,listener,options);
  let map=listenerMaps.get(this);if(!map){map=new Map();listenerMaps.set(this,map);}
  let wrapped=map.get(listener);
  if(!wrapped){wrapped=uuid===AUDIO_UUID?audioWrapper(listener):controlWrapper(listener);map.set(listener,wrapped);}
  return nativeAdd.call(this,type,wrapped,options);
};
NativeEventTarget.prototype.removeEventListener=function(type,listener,options){
  if(type==='characteristicvaluechanged'&&listener){
    const wrapped=listenerMaps.get(this)?.get(listener);
    if(wrapped)return nativeRemove.call(this,type,wrapped,options);
  }
  return nativeRemove.call(this,type,listener,options);
};

globalThis.SynapTransportCompat={version:1,lockFallback:document.documentElement.dataset.synapLockFallback==='1'};
})();
