/* Runtime UX contracts that must stay stable across dynamically injected Synap modules. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);

  function canonicalUrl(){
    try{return location.pathname+location.search}catch(_){return''}
  }
  function stripFragment(){
    try{
      if(location.hash&&typeof history.replaceState==='function')history.replaceState(history.state,'',canonicalUrl());
    }catch(_){}
  }
  function forceTop(){
    try{
      const scrolling=document.scrollingElement||document.documentElement;
      if(scrolling)scrolling.scrollTop=0;
      if(document.documentElement)document.documentElement.scrollTop=0;
      if(document.body)document.body.scrollTop=0;
      if(typeof window.scrollTo==='function')window.scrollTo(0,0);
    }catch(_){}
  }
  function nextFrame(fn){
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(fn);else setTimeout(fn,0);
  }
  function enforceStartupPosition(){
    try{if('scrollRestoration'in history)history.scrollRestoration='manual'}catch(_){}
    stripFragment();
    forceTop();
    nextFrame(()=>{forceTop();nextFrame(forceTop)});
    window.addEventListener('load',()=>{
      forceTop();
      nextFrame(forceTop);
      setTimeout(forceTop,120);
    },{once:true});
    window.addEventListener('pageshow',event=>{
      if(!event.persisted)return;
      stripFragment();
      forceTop();
      nextFrame(forceTop);
    });
    /* Programmatic jumps in memory/Ask flows may still use location.hash. Let the
       browser perform the jump, then immediately canonicalise the URL so a later
       app launch can never inherit that section as its startup position. */
    window.addEventListener('hashchange',()=>nextFrame(stripFragment));
  }

  enforceStartupPosition();

  function bindSettingsBrand(){
    function apply(){
      const homeLogo=document.querySelector('.topbar .brand-logo');
      const settingsLogo=document.querySelector('.pendant-settings-top .settings-brand-logo');
      if(!settingsLogo)return;
      const source=homeLogo?.getAttribute('src')||'logo.webp?v=1.0.0';
      if(settingsLogo.getAttribute('src')!==source)settingsLogo.setAttribute('src',source);
      settingsLogo.alt='synap';
      settingsLogo.removeAttribute('width');
      settingsLogo.removeAttribute('height');
      settingsLogo.classList.add('synap-brand-image');
      settingsLogo.dataset.brandSource='home-wordmark';
    }
    apply();
    const dialog=$('settingsDialog');
    if(dialog)new MutationObserver(apply).observe(dialog,{childList:true,subtree:true,attributes:true,attributeFilter:['src','class']});
    $('settingsButton')?.addEventListener('click',()=>nextFrame(apply));
  }

  function bindFirmwareAffordance(){
    const check=$('otaReleaseCheck'),latest=$('otaLatest'),status=$('otaStatus'),progress=$('otaProgress');
    if(!check||!latest||!status)return;
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    function render(){
      const message=(status.textContent||'').replace(/\s+/g,' ').trim();
      const updateReady=!latest.hidden;
      check.hidden=updateReady;
      if(updateReady){
        latest.setAttribute('aria-label',(latest.textContent||'Update').trim()+' firmware');
        latest.title=message||'Firmware update available';
        return;
      }
      let label='Firmware';
      if(/^Checking/i.test(message))label='Checking…';
      else {
        const current=message.match(/Up to date\s*[·-]\s*(\d+)/i);
        if(current)label=`FW ${current[1]} ✓`;
        else if(/paused|continue/i.test(message))label='Continue';
      }
      check.textContent=label;
      check.setAttribute('aria-label',message?`Firmware: ${message}`:'Check firmware update');
      check.title=message||'Check firmware update';
      check.dataset.state=/Up to date/i.test(message)?'current':/Checking/i.test(message)?'checking':/error|failed|unable/i.test(message)?'error':'idle';
      if(progress&&!progress.hidden)check.hidden=true;
    }
    new MutationObserver(render).observe(status,{childList:true,subtree:true,characterData:true});
    new MutationObserver(render).observe(latest,{attributes:true,attributeFilter:['hidden'],childList:true,subtree:true});
    if(progress)new MutationObserver(render).observe(progress,{attributes:true,attributeFilter:['hidden','value']});
    render();
  }

  function bindBrainTabs(){
    const nav=document.querySelector('.brain-tabs');
    if(!nav)return;
    let raf=0;
    const links=()=>[...nav.querySelectorAll('a[href^="#"]')];
    function select(link){
      for(const item of links()){
        const active=item===link;
        item.classList.toggle('active',active);
        if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
      }
    }
    function update(){
      raf=0;
      const items=links().map(link=>({link,section:document.querySelector(link.getAttribute('href'))})).filter(x=>x.section);
      if(!items.length)return;
      const header=document.querySelector('.topbar');
      const boundary=(header?.getBoundingClientRect().bottom||70)+28;
      let chosen=items[0];
      for(const item of items)if(item.section.getBoundingClientRect().top<=boundary)chosen=item;
      if(window.scrollY>0&&window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-6)chosen=items[items.length-1];
      select(chosen.link);
    }
    function schedule(){if(!raf)raf=requestAnimationFrame(update)}
    nav.addEventListener('click',event=>{
      const link=event.target.closest('a[href^="#"]');
      if(!link)return;
      const section=document.querySelector(link.getAttribute('href'));
      if(!section){select(link);return}
      event.preventDefault();
      select(link);
      const reduced=document.documentElement.hasAttribute('data-reduced-motion')||window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      section.scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'});
      stripFragment();
    });
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule,{passive:true});
    window.addEventListener('hashchange',schedule);
    new MutationObserver(schedule).observe(nav,{childList:true,subtree:true});
    if(typeof ResizeObserver!=='undefined'){
      const observer=new ResizeObserver(schedule);observer.observe(document.querySelector('main')||document.body);
    }
    update();
  }

  function bindReducedMotion(){
    const media=typeof window.matchMedia==='function'?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
    const apply=()=>document.documentElement.toggleAttribute('data-reduced-motion',!!media?.matches);
    media?.addEventListener?.('change',apply);apply();
  }

  function init(){bindSettingsBrand();bindFirmwareAffordance();bindBrainTabs();bindReducedMotion()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();