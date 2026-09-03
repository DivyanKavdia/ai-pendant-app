/* Synap production UX: local memory retrieval, storage/service health and diagnostics export. */
(function(){
  'use strict';
  const SHELL_REVISION='1.0.0-prod2';
  const DB_NAME='dk-pendant-recordings';
  const riskyStates=new Set(['recording','starting','stopping','saving','updating']);
  const formatBytes=n=>{if(!n)return '0 B';const u=['B','KB','MB','GB'],i=Math.min(u.length-1,Math.floor(Math.log(n)/Math.log(1024)));return (n/1024**i).toFixed(i?1:0)+' '+u[i];};
  const localDateKey=value=>{const d=new Date(value);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  function openDb(){
    return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  }
  async function recordings(){
    const db=await openDb();
    try{return await new Promise((resolve,reject)=>{const request=db.transaction('recordings').objectStore('recordings').getAll();request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error);});}
    finally{db.close();}
  }
  function injectStyles(){
    const style=document.createElement('style');style.textContent=`
      .memory-search{margin:.75rem 0 1.1rem;display:grid;gap:.55rem}.memory-search-row{display:flex;gap:.55rem;align-items:center}
      .memory-search input{width:100%;min-width:0;border:1px solid var(--border,#d8d7e2);border-radius:14px;background:var(--card-bg,#fff);color:inherit;padding:.8rem .9rem;font:inherit}
      .memory-results{display:grid;gap:.5rem}.memory-result{width:100%;text-align:left;border:1px solid var(--border,#ddd);border-radius:14px;background:transparent;color:inherit;padding:.75rem .85rem;cursor:pointer}
      .memory-result strong,.memory-result span{display:block}.memory-result span{font-size:.82rem;opacity:.65;margin-top:.15rem}.memory-result p{margin:.35rem 0 0;line-height:1.4;font-size:.9rem;opacity:.84}
      .system-health-body{display:grid;gap:.65rem;padding-top:.5rem}.system-health-row{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.system-health-row span{opacity:.68}.system-health-row strong{text-align:right;font-weight:650}
      .system-health-warning{font-size:.82rem;line-height:1.4;margin:0;opacity:.8}.update-reload{margin-left:.65rem}.memory-empty{font-size:.86rem;opacity:.66;margin:.1rem 0 0}
    `;document.head.appendChild(style);
  }
  function injectMemorySearch(){
    const section=document.getElementById('insights'),heading=section?.querySelector('.section-heading');if(!section||!heading||document.getElementById('memorySearch'))return;
    const wrap=document.createElement('div');wrap.id='memorySearch';wrap.className='memory-search';
    const row=document.createElement('div');row.className='memory-search-row';
    const input=document.createElement('input');input.type='search';input.placeholder='Search your memory…';input.autocomplete='off';input.setAttribute('aria-label','Search all transcripts, summaries and notes');
    const results=document.createElement('div');results.className='memory-results';results.setAttribute('aria-live','polite');
    row.appendChild(input);wrap.append(row,results);heading.insertAdjacentElement('afterend',wrap);
    let timer=0,epoch=0;
    input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(async()=>{
      const query=input.value.trim().toLowerCase(),current=++epoch;results.replaceChildren();if(query.length<2)return;
      const terms=query.split(/\s+/).filter(Boolean),items=await recordings().catch(()=>[]);if(current!==epoch)return;
      const ranked=items.map(item=>{
        const name=String(item.name||''),notes=String(item.notes||''),summary=String(item.summary||''),transcript=String(item.transcript||'');
        const fields=[name,notes,summary,transcript].map(x=>x.toLowerCase());let score=0;
        for(const term of terms){if(fields[0].includes(term))score+=8;if(fields[1].includes(term))score+=5;if(fields[2].includes(term))score+=4;if(fields[3].includes(term))score+=2;}
        return {item,score,text:summary||transcript||notes||name};
      }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||new Date(b.item.createdAt)-new Date(a.item.createdAt)).slice(0,8);
      if(!ranked.length){const empty=document.createElement('p');empty.className='memory-empty';empty.textContent='No matching memories yet.';results.appendChild(empty);return;}
      for(const hit of ranked){
        const button=document.createElement('button');button.type='button';button.className='memory-result';
        const title=document.createElement('strong');title.textContent=hit.item.name||'Untitled recording';
        const meta=document.createElement('span');meta.textContent=new Date(hit.item.createdAt).toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
        const text=document.createElement('p');const raw=hit.text.replace(/\s+/g,' ').trim();text.textContent=raw.length>220?raw.slice(0,217)+'…':raw;
        button.append(title,meta,text);button.addEventListener('click',()=>{
          const picker=document.getElementById('datePicker'),key=localDateKey(hit.item.createdAt);if(picker){picker.value=key;picker.dispatchEvent(new Event('change',{bubbles:true}));}
          setTimeout(()=>{const card=document.getElementById('recording-'+hit.item.id);if(card){card.open=true;card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});card.querySelector('summary')?.focus({preventScroll:true});}},250);
          location.hash='#library';
        });results.appendChild(button);
      }
    },180);});
  }
  function injectSystemHealth(){
    const diagnostics=document.getElementById('diagnostics');if(!diagnostics||document.getElementById('systemHealth'))return;
    const details=document.createElement('details');details.id='systemHealth';details.className='settings-card';
    details.innerHTML='<summary class="settings-card-head"><span class="settings-icon"><svg aria-hidden="true"><use href="#i-check"/></svg></span><span class="settings-heading"><strong>System status</strong></span><svg class="disclosure-chevron" aria-hidden="true"><use href="#i-chevron"/></svg></summary><div class="system-health-body"><div class="system-health-row"><span>Browser storage</span><strong id="storageHealth">Checking…</strong></div><div class="system-health-row"><span>Offline app</span><strong id="serviceHealth">Checking…</strong></div><div class="system-health-row"><span>Network</span><strong id="networkHealth">—</strong></div><p id="storageWarning" class="system-health-warning"></p></div>';
    diagnostics.insertAdjacentElement('beforebegin',details);
    details.addEventListener('toggle',()=>{if(details.open)refreshSystemHealth();});
  }
  async function refreshSystemHealth(){
    const storage=document.getElementById('storageHealth'),service=document.getElementById('serviceHealth'),network=document.getElementById('networkHealth'),warning=document.getElementById('storageWarning');if(!storage)return;
    network.textContent=navigator.onLine?'Online':'Offline';
    service.textContent=navigator.serviceWorker?.controller?'Ready':'Installing / browser managed';
    try{
      const estimate=await navigator.storage?.estimate?.(),persisted=await navigator.storage?.persisted?.();
      if(estimate?.quota){const ratio=(estimate.usage||0)/estimate.quota;storage.textContent=`${formatBytes(estimate.usage||0)} of ${formatBytes(estimate.quota)} · ${persisted?'protected':'evictable'}`;warning.textContent=ratio>=.85?'Storage is above 85%. Export or remove recordings before the browser runs out of space.':persisted?'Storage protection is enabled for this browser.':'The browser may evict local recordings under storage pressure.';}
      else {storage.textContent='Available';warning.textContent='Storage quota details are not exposed by this browser.';}
    }catch(error){storage.textContent='Unavailable';warning.textContent=error.message;}
  }
  function injectDiagnosticsExport(){
    const actions=document.querySelector('#diagnostics .setting-actions');if(!actions||document.getElementById('downloadDiagnosticsButton'))return;
    const button=document.createElement('button');button.id='downloadDiagnosticsButton';button.type='button';button.className='text-button';button.textContent='Download log';
    button.addEventListener('click',()=>{const text=document.getElementById('diagnosticsLog')?.textContent||'';const blob=new Blob([text],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='synap-diagnostics-'+new Date().toISOString().replace(/[:.]/g,'-')+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    actions.appendChild(button);
  }
  function maintainUpdateNotice(){
    const notice=document.getElementById('updateNotice');if(!notice)return;
    const render=()=>{
      if(notice.hidden||!notice.textContent.includes('App update ready'))return;
      if(notice.querySelector('.update-reload'))return;
      const button=document.createElement('button');button.type='button';button.className='button button-secondary button-small update-reload';button.textContent='Reload';
      const state=document.body.dataset.state;button.disabled=riskyStates.has(state);button.title=button.disabled?'Finish the current operation first':'Load the new app version';button.addEventListener('click',()=>location.reload());notice.appendChild(button);
    };
    new MutationObserver(render).observe(notice,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
    new MutationObserver(render).observe(document.body,{attributes:true,attributeFilter:['data-state']});render();
    navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='APP_VERSION'&&(event.data.revision||event.data.version)===SHELL_REVISION)setTimeout(()=>{if(notice.textContent.includes('App update ready'))notice.hidden=true;},0);});
  }
  document.addEventListener('click',event=>{if(event.target.closest?.('#settingsButton'))setTimeout(refreshSystemHealth,0);});
  addEventListener('online',refreshSystemHealth);addEventListener('offline',refreshSystemHealth);
  function init(){injectStyles();injectMemorySearch();injectSystemHealth();injectDiagnosticsExport();maintainUpdateNotice();refreshSystemHealth();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
