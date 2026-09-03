/* Compact, product-facing capture controls. Core BLE/recording behavior remains in app.js. */
(function(){
  'use strict';
  const TAGLINE='Stay present. Keep the memory.';
  const PUBLIC_VERSION='1.0.0';
  const LOGO='logo.webp?v=1.0.0';
  const ACTIVE_STATES=new Set(['idle','recording','starting','stopping','saving']);
  const RECORDING_STATES=new Set(['recording','starting']);
  const BUSY_STATES=new Set(['stopping','saving','updating','connecting']);

  function init(){
    const header=document.querySelector('.topbar');
    const actions=document.querySelector('.top-actions');
    const section=document.getElementById('capture');
    const connect=document.getElementById('connectButton');
    const start=document.getElementById('startButton');
    const stop=document.getElementById('stopButton');
    const timer=document.getElementById('timer');
    const settings=document.getElementById('settingsButton');
    if(!header||!actions||!section||!connect||!start||!stop||!settings||document.getElementById('headerCaptureToggle'))return;

    /* Only the primary wordmark uses logo.webp. The Settings device tile intentionally keeps icon-192.png. */
    const headerLogo=header.querySelector('.brand-logo');
    if(headerLogo){headerLogo.src=LOGO;headerLogo.alt='synap';headerLogo.classList.add('synap-brand-image');}
    document.title='synap · '+TAGLINE;
    document.querySelector('meta[name="description"]')?.setAttribute('content','synap — '+TAGLINE);
    const appVersion=document.getElementById('appVersion');
    if(appVersion)appVersion.textContent=PUBLIC_VERSION;

    /* Keep queue controls available in Settings without making them part of the primary recording flow. */
    const processing=document.getElementById('processing');
    const queueStatus=document.getElementById('queueStatus');
    const runQueue=document.getElementById('runQueueButton');
    const pauseQueue=document.getElementById('pauseQueueButton');
    const processingSettings=document.querySelector('.processing-settings .settings-row-body');
    const memoryStatus=document.getElementById('memoryProcessingStatus');
    if(processing&&queueStatus&&runQueue&&pauseQueue&&processingSettings){
      processing.hidden=true;
      let controls=document.getElementById('backgroundMemoryControls');
      if(!controls){
        controls=document.createElement('div');
        controls.id='backgroundMemoryControls';
        controls.className='background-memory-controls';
        const label=document.createElement('div');
        label.className='background-memory-label';
        label.innerHTML='<strong>Memory processing</strong><small>Runs quietly in the background. Use these controls only when needed.</small>';
        const state=document.createElement('p');
        state.id='settingsMemoryStatus';
        state.className='background-memory-state';
        state.setAttribute('role','status');
        state.setAttribute('aria-live','polite');
        const buttons=document.createElement('div');
        buttons.className='setting-actions background-memory-actions';
        buttons.append(runQueue,pauseQueue);
        controls.append(label,state,buttons);
        processingSettings.appendChild(controls);
        const syncProcessing=()=>{
          const text=(queueStatus.textContent||'').trim();
          const idle=/^(Ready to process|Queue complete|Paused)/i.test(text);
          state.textContent=text;
          state.classList.toggle('is-active',!idle);
          if(memoryStatus){memoryStatus.textContent=text;memoryStatus.hidden=idle||!text;}
        };
        new MutationObserver(syncProcessing).observe(queueStatus,{childList:true,subtree:true,characterData:true});
        syncProcessing();
      }
    }

    section.classList.add('capture-minimal');
    section.setAttribute('aria-hidden','true');

    const status=document.createElement('button');
    status.id='headerPendantStatus';
    status.className='header-pendant-status';
    status.type='button';
    status.setAttribute('aria-label','Pendant connection');
    status.innerHTML='<span class="header-status-dot" aria-hidden="true"></span><span class="header-status-text">Offline</span>';
    status.addEventListener('click',()=>connect.click());

    const toggle=document.createElement('button');
    toggle.id='headerCaptureToggle';
    toggle.className='header-capture-toggle';
    toggle.type='button';
    toggle.setAttribute('aria-label','Start listening');
    toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8"/></svg><span class="header-stop" aria-hidden="true"></span>';
    actions.prepend(status,toggle);

    function sync(){
      const state=document.body.dataset.state||'disconnected';
      const recording=RECORDING_STATES.has(state);
      const connected=ACTIVE_STATES.has(state);
      const busy=BUSY_STATES.has(state);
      status.classList.toggle('is-connected',connected);
      status.classList.toggle('is-recording',recording);
      status.querySelector('.header-status-text').textContent=recording?'Listening':connected?'Connected':state==='connecting'?'Connecting':'Offline';
      toggle.classList.toggle('is-recording',recording);
      toggle.disabled=busy&&!recording?true:(recording?stop.disabled:start.disabled);
      toggle.setAttribute('aria-label',recording?'Stop listening':'Start listening');
      if(timer)toggle.dataset.time=recording?timer.textContent:'';
    }
    toggle.addEventListener('click',()=>{
      const state=document.body.dataset.state||'';
      (RECORDING_STATES.has(state)?stop:start).click();
    });
    new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-state']});
    if(timer)new MutationObserver(sync).observe(timer,{childList:true,subtree:true,characterData:true});
    new MutationObserver(sync).observe(start,{attributes:true,attributeFilter:['disabled']});
    new MutationObserver(sync).observe(stop,{attributes:true,attributeFilter:['disabled']});
    sync();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
