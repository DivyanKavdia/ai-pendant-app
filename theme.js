/* Apply before first paint; appearance and platform compatibility load before app.js. */
(function(){
  'use strict';

  // Bluefy/iOS may not expose Web Locks. app.js only needs a page-lifetime
  // exclusive token here; do not abort initialization and leave every control dead.
  if(typeof navigator!=='undefined'&&!navigator.locks){
    const fallback={async request(name,options,callback){if(typeof options==='function'){callback=options;options={};}return callback({name:String(name||''),mode:'exclusive'});}};
    try{Object.defineProperty(navigator,'locks',{value:fallback,configurable:true});}catch(_){try{navigator.locks=fallback}catch(__){}}
    document.documentElement.dataset.synapLockFallback='1';
  }

  // Firmware may now use 4-20 chunks/frame and up to 500-byte payloads when the
  // negotiated MTU allows it. Current app.js intentionally keeps its proven
  // 10x160-byte assembler, so adapt only the BLE event boundary: fewer radio
  // notifications are re-segmented in memory without changing PCM or protocol v2.
  const AUDIO_UUID='4fa12346-0000-1000-8000-00805f9b34fb',CONTROL_UUID='4fa12347-0000-1000-8000-00805f9b34fb';
  const AUDIO_MAGIC=0xA5,STATUS_MAGIC=0x5A,PROTO=2,HEADER=8,FRAME=1600,LEGACY_CHUNKS=10,LEGACY_PAYLOAD=160;
  const ET=globalThis.EventTarget;
  if(ET&&ET.prototype&&!globalThis.__synapBleCompatInstalled){
    globalThis.__synapBleCompatInstalled=true;
    const add=ET.prototype.addEventListener,remove=ET.prototype.removeEventListener,maps=new WeakMap(),framesByTarget=new WeakMap();
    const uuid=t=>String(t&&t.uuid||'').toLowerCase();
    const invoke=(l,c,e)=>typeof l==='function'?l.call(c,e):l?.handleEvent?.(e);
    const copy=v=>{const b=new Uint8Array(v.byteLength);b.set(new Uint8Array(v.buffer,v.byteOffset,v.byteLength));return b};
    const fake=(v,e)=>({target:{value:v},currentTarget:e?.currentTarget||null,type:'characteristicvaluechanged'});
    function audioWrap(listener){return function(event){
      const target=event?.target,v=target?.value;if(uuid(target)!==AUDIO_UUID||!v||v.byteLength<HEADER||v.getUint8(0)!==AUDIO_MAGIC||v.getUint8(1)!==PROTO)return invoke(listener,this,event);
      const total=v.getUint8(5),len=v.getUint16(6,true);if(total>=10&&len<=160)return invoke(listener,this,event);
      const seq=v.getUint16(2,true),idx=v.getUint8(4);if(total<1||total>20||idx>=total||len<1||len>500||HEADER+len!==v.byteLength)return invoke(listener,this,event);
      let frames=framesByTarget.get(target);if(!frames){frames=new Map();framesByTarget.set(target,frames)}
      let f=frames.get(seq);if(!f||f.total!==total){f={total,chunks:new Array(total),count:0};frames.set(seq,f)}
      if(!f.chunks[idx]){const p=new Uint8Array(len);p.set(new Uint8Array(v.buffer,v.byteOffset+HEADER,len));f.chunks[idx]=p;f.count++}
      if(f.count!==f.total)return;frames.delete(seq);
      const pcm=new Uint8Array(FRAME);let off=0;for(let i=0;i<f.total;i++){const p=f.chunks[i];if(!p||off+p.length>FRAME)return;pcm.set(p,off);off+=p.length}if(off!==FRAME)return;
      for(let i=0;i<LEGACY_CHUNKS;i++){const packet=new Uint8Array(HEADER+LEGACY_PAYLOAD);packet[0]=AUDIO_MAGIC;packet[1]=PROTO;packet[2]=seq&255;packet[3]=seq>>8;packet[4]=i;packet[5]=LEGACY_CHUNKS;packet[6]=LEGACY_PAYLOAD;packet[7]=0;packet.set(pcm.subarray(i*LEGACY_PAYLOAD,(i+1)*LEGACY_PAYLOAD),HEADER);invoke(listener,this,fake(new DataView(packet.buffer),event))}
    }}
    function controlWrap(listener){return function(event){
      const target=event?.target,v=target?.value;if(uuid(target)!==CONTROL_UUID||!v||v.byteLength!==16||v.getUint8(0)!==STATUS_MAGIC||v.getUint8(1)!==PROTO)return invoke(listener,this,event);
      const chunks=v.getUint8(8),payload=v.getUint16(14,true);if(v.getUint8(2)!==2||(chunks>=10&&payload<=160))return invoke(listener,this,event);
      const b=copy(v);b[8]=LEGACY_CHUNKS;b[14]=LEGACY_PAYLOAD;b[15]=0;return invoke(listener,this,fake(new DataView(b.buffer),event));
    }}
    ET.prototype.addEventListener=function(type,listener,options){
      if(type!=='characteristicvaluechanged'||!listener)return add.call(this,type,listener,options);const u=uuid(this);if(u!==AUDIO_UUID&&u!==CONTROL_UUID)return add.call(this,type,listener,options);
      let map=maps.get(this);if(!map){map=new Map();maps.set(this,map)}let wrapped=map.get(listener);if(!wrapped){wrapped=u===AUDIO_UUID?audioWrap(listener):controlWrap(listener);map.set(listener,wrapped)}return add.call(this,type,wrapped,options);
    };
    ET.prototype.removeEventListener=function(type,listener,options){const wrapped=type==='characteristicvaluechanged'&&listener?maps.get(this)?.get(listener):null;return remove.call(this,type,wrapped||listener,options)};
  }

  if(typeof history!=='undefined'&&'scrollRestoration'in history)history.scrollRestoration='manual';
  /* iOS/PWA can reopen the last fragment (#library/#ask/etc.) and restore into the
     middle of the app. Remove it before layout so a new synap launch is canonical. */
  try{
    if(typeof location!=='undefined'&&location.hash&&typeof history?.replaceState==='function'){
      history.replaceState(history.state,'',location.pathname+location.search);
    }
  }catch(_){}
  const key='synap-appearance';
  const SHELL_REVISION='1.0.0-logo4';
  const root=document.documentElement;
  const valid=v=>['system','light','dark'].includes(v)?v:'system';
  let preference='system';
  try{preference=valid(localStorage.getItem(key))}catch(_){}

  function autoMode(){
    const hour=new Date().getHours();
    return hour>=7&&hour<19?'light':'dark';
  }
  function apply(){
    const mode=preference==='system'?autoMode():preference;
    root.dataset.theme=mode;
    root.setAttribute('data-theme',mode);
    root.style.colorScheme=mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',mode==='dark'?'#071426':'#f7f9fc');
    document.querySelectorAll('[data-theme-choice]').forEach(b=>{
      b.setAttribute('aria-pressed',String(b.dataset.themeChoice===preference));
      if(b.dataset.themeChoice==='system'){
        b.title='Auto: light 7 AM–7 PM, dark 7 PM–7 AM';
        b.setAttribute('aria-label','Auto appearance — light 7 AM to 7 PM, dark 7 PM to 7 AM');
      }
    });
  }
  function choose(value){
    preference=valid(value);
    try{localStorage.setItem(key,preference)}catch(_){}
    apply();
  }
  function refreshAuto(){if(preference==='system')apply()}
  function css(href,k,v){
    if(document.querySelector(`link[data-synap-${k}]`))return;
    const l=document.createElement('link');l.rel='stylesheet';l.href=href;
    l.dataset['synap'+k[0].toUpperCase()+k.slice(1)]=v;document.head.appendChild(l);
  }
  function script(src){
    if(document.querySelector(`script[src="${src}"]`))return;
    const s=document.createElement('script');s.src=src;s.defer=true;document.head.appendChild(s);
  }
  function $(id){return typeof document.getElementById==='function'?document.getElementById(id):null}
  function installAISettings(){
    if(typeof document.getElementById!=='function')return;
    const fields=document.querySelector('.processing-fields'),endpoint=$('endpointInput'),llm=$('llmEndpointInput'),token=$('tokenInput');
    if(!fields||!endpoint||!llm||!token||$('providerInput'))return;
    const p=document.createElement('label');p.className='field';
    p.innerHTML='<span>AI provider</span><select id="providerInput"><option value="openai">OpenAI</option><option value="custom">Custom / other provider</option></select><small>OpenAI needs only an API key. Custom mode keeps endpoint support.</small>';
    const models=document.createElement('div');models.id='openAIModelFields';models.className='processing-fields';
    models.innerHTML='<label class="field"><span>Transcription model</span><select id="sttModelInput"><option value="gpt-4o-mini-transcribe">GPT-4o mini Transcribe</option><option value="gpt-4o-transcribe">GPT-4o Transcribe</option><option value="gpt-4o-transcribe-diarize">GPT-4o Transcribe Diarize</option></select></label><label class="field"><span>Memory model</span><select id="llmModelInput"><option value="gpt-5-mini">GPT-5 mini</option><option value="gpt-5">GPT-5</option><option value="gpt-4.1-mini">GPT-4.1 mini</option></select><small>Builds conversations, people, decisions, commitments and follow-ups.</small></label><label class="field"><span>Transcription language</span><select id="languageInput"><option value="auto">Auto detect</option><option value="en">English</option><option value="hi">Hindi / Hinglish</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="ja">Japanese</option></select></label>';
    const custom=document.createElement('div');custom.id='customEndpointFields';custom.className='processing-fields';custom.append(endpoint.closest('label'),llm.closest('label'));
    const tl=token.closest('label')?.querySelector('span');if(tl){tl.id='apiKeyLabel';tl.textContent='OpenAI API key'}
    token.placeholder='sk-…';token.autocomplete='off';fields.prepend(p,models,custom);
    script('ai-providers.js?v=0.0.1-brain3');script('recording-bridge.js?v=1.0.0-touch1');
  }
  function bind(){
    document.querySelectorAll('[data-theme-choice]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();choose(b.dataset.themeChoice)}));
    document.addEventListener('click',e=>{const b=e.target.closest?.('[data-theme-choice]');if(b){e.preventDefault();choose(b.dataset.themeChoice)}});
    installAISettings();
    css('settings-icon-fix.css?v=1.0.0-logo3','settingsicon','logo3');
    script('capture-ui.js?v=1.0.0-ui6');
    script('brain-ui.js?v=0.0.1-brain7');
    script('product-ui.js?v=1.0.0-ui4');
    script('runtime-ui.js?v=1.0.0-runtime3');
    apply();
  }
  css('brand.css?v=1.0.0-brain1','brand','brain1');
  css('compact.css?v=0.0.1-ui3','compact','ui3');
  css('brain.css?v=0.0.1-brain10','brain','brain10');
  window.addEventListener('storage',e=>{if(e.key===key||e.key===null){preference=valid(e.newValue);apply()}});
  window.addEventListener('focus',refreshAuto);
  window.addEventListener('pageshow',refreshAuto);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAuto()});
  if(typeof setInterval==='function')setInterval(refreshAuto,60000);
  apply();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();