/* Apply before first paint; appearance is independent of recording settings. */
(function(){
  'use strict';
  if(typeof history!=='undefined'&&'scrollRestoration'in history)history.scrollRestoration='manual';
  const key='synap-appearance';
  const SHELL_REVISION='1.0.0-diag1';
  const root=document.documentElement;
  const systemTheme=typeof window!=='undefined'&&typeof window.matchMedia==='function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
  const valid=v=>['system','light','dark'].includes(v)?v:'system';
  let preference='system';
  try{preference=valid(localStorage.getItem(key))}catch(_){}

  function autoMode(){return systemTheme?.matches?'dark':'light'}
  function apply(){
    const mode=preference==='system'?autoMode():preference;
    root.dataset.theme=mode;
    root.setAttribute('data-theme',mode);
    root.style.colorScheme=mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',mode==='dark'?'#071426':'#f7f9fc');
    document.querySelectorAll('[data-theme-choice]').forEach(b=>{
      b.setAttribute('aria-pressed',String(b.dataset.themeChoice===preference));
      if(b.dataset.themeChoice==='system'){
        b.title='Follow device appearance';
        b.setAttribute('aria-label','Auto appearance — follow device setting');
      }
    });
  }
  function choose(value){
    preference=valid(value);
    try{localStorage.setItem(key,preference)}catch(_){}
    apply();
  }
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
    script('capture-ui.js?v=0.0.1-ui2');
    script('brain-ui.js?v=0.0.1-brain7');
    script('product-ui.js?v=1.0.0-ui4');
    script('runtime-ui.js?v=1.0.0-runtime1');
    apply();
  }
  css('brand.css?v=1.0.0-brain1','brand','brain1');
  css('compact.css?v=0.0.1-ui3','compact','ui3');
  css('brain.css?v=0.0.1-brain10','brain','brain10');
  window.addEventListener('storage',e=>{if(e.key===key||e.key===null){preference=valid(e.newValue);apply()}});
  systemTheme?.addEventListener?.('change',()=>{if(preference==='system')apply()});
  apply();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();