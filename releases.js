/* Public release feed + per-device browser authorization. No plaintext key storage. */
(function(root){
  'use strict';
  const TARGET='esp32s3-fh4r2-qspi-4m';
  const BASE='https://raw.githubusercontent.com/DivyanKavdia/synap-firmware/ota-releases/';
  const IDENTITY_UUID='4fa1234b-0000-1000-8000-00805f9b34fb';
  const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
  function validateManifest(m) {
    if(!m||m.schema!==1||m.target!==TARGET||m.protocol!==2||m.chip!==9||m.partition!=='default'||
      m.flashBytes!==4194304||m.psramBytes!==2097152||!integer(m.build,504,65535)||
      !integer(m.size,288,0x140000)||!/^\d+\.\d+\.\d+$/.test(m.version)||
      !/^[a-f0-9]{64}$/.test(m.sha256)||!/^[a-f0-9]{40}$/.test(m.commit)||
      m.identity!==`SYNAP-FW:${TARGET}:${m.version}:${m.build}`||
      m.url!==`${BASE}builds/${m.build}-${m.sha256}.bin`) throw Error('Invalid or incompatible firmware release manifest.');
    return Object.freeze({...m});
  }
  function compatible(m,info,identity) {
    validateManifest(m);
    if(info.protocol!==2||info.state===0||info.capacity<m.size||info.maxData<64) throw Error('This pendant needs compatible OTA slots and BLE MTU before updating.');
    if(identity) {
      const parts=identity.split(':');
      if(parts.length!==4||parts[0]!=='SYNAP-FW'||parts[1]!==TARGET||Number(parts[3])!==info.build) throw Error('The connected pendant is a different hardware target.');
    } else if(info.build!==503) throw Error('Unknown pendant hardware. Use a verified manual migration first.');
    return m.build>info.build;
  }
  async function boundedResponse(response,limit) {
    if(!response.ok) throw Error(`Firmware server returned HTTP ${response.status}.`);
    if(Number(response.headers.get('content-length'))>limit) throw Error('Firmware response exceeds size limit.');
    const reader=response.body?.getReader();
    if(!reader) {const b=new Uint8Array(await response.arrayBuffer());if(b.length>limit)throw Error('Firmware response exceeds size limit.');return b;}
    const chunks=[];let length=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;
      if(length>limit)throw Error('Firmware response exceeds size limit.');chunks.push(value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}
    finally {reader.releaseLock();}
    const result=new Uint8Array(length);let offset=0;for(const b of chunks){result.set(b,offset);offset+=b.length;}return result;
  }
  async function request(url,limit,fetcher=root.fetch.bind(root),signal) {
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    try {if(signal?.aborted)controller.abort();return await boundedResponse(await fetcher(url,
      {cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal}),limit);}
    finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  async function latest(fetcher) {
    return validateManifest(JSON.parse(new TextDecoder().decode(await request(BASE+'latest.json?t='+Date.now(),8192,fetcher))));
  }
  async function download(m,capacity,fetcher,signal) {
    validateManifest(m);if(m.size>capacity)throw Error('Firmware does not fit this pendant.');
    const bytes=await request(m.url,m.size,fetcher,signal);
    if(bytes.length!==m.size)throw Error('Firmware download is incomplete.');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==m.sha256)throw Error('Firmware download SHA-256 mismatch. Nothing was flashed.');
    root.SynapOTA.validateImage(bytes,capacity,2);
    const marker=new TextEncoder().encode(m.identity+'\0');
    let found=false;
    for(let i=0;i<=bytes.length-marker.length;i++){
      if(marker.every((b,j)=>bytes[i+j]===b)){found=true;break;}
    }
    if(!found)throw Error('Firmware image target/build does not match the release.');
    return new Blob([bytes],{type:'application/octet-stream'});
  }
  class OwnerVault {
    async open(){return new Promise((resolve,reject)=>{
      const req=indexedDB.open('synap-ota-authorization',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('devices');
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      req.onblocked=()=>reject(Error('Close other Synap tabs to open authorization storage.'));
    });}
    async operation(id,mode,action){
      if(!id)throw Error('Select a pendant before managing authorization.');
      const db=await this.open();
      try{return await new Promise((resolve,reject)=>{
        const tx=db.transaction('devices',mode),req=action(tx.objectStore('devices'));
        tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error||Error('Authorization storage failed.'));
        tx.onerror=()=>reject(tx.error);
      });}finally{db.close();}
    }
    async get(id){const key=await this.operation(id,'readonly',s=>s.get(id));return root.SynapOTA.isOwnerKey(key)?key:null;}
    async put(id,key){if(!root.SynapOTA.isOwnerKey(key))throw Error('Only non-extractable authorization keys may be saved.');
      await this.operation(id,'readwrite',s=>s.put(key,id));}
    async forget(id){await this.operation(id,'readwrite',s=>s.delete(id));}
  }
  root.SynapReleases={TARGET,BASE,IDENTITY_UUID,validateManifest,compatible,latest,download,OwnerVault};
  if(typeof module!=='undefined')module.exports=root.SynapReleases;
})(globalThis);
