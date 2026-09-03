/* Signed production release feed for device-ID OTA. */
(function(root){
  'use strict';
  const TARGET='esp32s3-fh4r2-qspi-4m';
  const BASE='https://raw.githubusercontent.com/DivyanKavdia/synap-firmware/ota-releases/';
  const IDENTITY_UUID='4fa1234b-0000-1000-8000-00805f9b34fb';
  const LEGACY_UNSIGNED_MAX_BUILD=1008;
  const SIGNING_KEY_ID='prod-2026-01';
  const SIGNING_PUBLIC_KEY_SPKI='MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEupYML35H78nn+VUqkHS15RrxYX86EsMOhBOaAkWriN/qn1r4SqguBfaha7l7sgKVRQ53VUA3sWWS0/MrcynUNQ==';
  const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
  const b64bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  function canonicalManifest(m) {
    return JSON.stringify({schema:m.schema,version:m.version,build:m.build,target:m.target,protocol:m.protocol,chip:m.chip,
      flashBytes:m.flashBytes,psramBytes:m.psramBytes,partition:m.partition,size:m.size,sha256:m.sha256,
      commit:m.commit,identity:m.identity,url:m.url,channel:m.channel});
  }
  function validateManifest(m) {
    const legacy=m?.schema===1 && m.build<=LEGACY_UNSIGNED_MAX_BUILD && m.channel===undefined;
    const signed=m?.schema===2 && m.channel==='production';
    if(!m||(!legacy&&!signed)||m.target!==TARGET||m.protocol!==3||m.chip!==9||m.partition!=='default'||
      m.flashBytes!==4194304||m.psramBytes!==2097152||!integer(m.build,504,65535)||
      !integer(m.size,288,0x140000)||!/^\d+\.\d+\.\d+$/.test(m.version)||
      !/^[a-f0-9]{64}$/.test(m.sha256)||!/^[a-f0-9]{40}$/.test(m.commit)||
      m.identity!==`SYNAP-FW:${TARGET}:${m.version}:${m.build}`||
      m.url!==`${BASE}builds/${m.build}-${m.sha256}.bin`) throw Error('Invalid or incompatible firmware release manifest.');
    if(signed&&(!m.signing||m.signing.alg!=='ES256'||m.signing.keyId!==SIGNING_KEY_ID||
      !/^[A-Za-z0-9+/]{86}==$/.test(m.signing.value))) throw Error('Production firmware manifest is not signed by Synap.');
    if(legacy&&m.signing)throw Error('Legacy firmware manifest must not contain a signature.');
    return Object.freeze({...m,signing:m.signing?Object.freeze({...m.signing}):undefined});
  }
  let verifyKeyPromise=null;
  async function verifyManifest(m) {
    const manifest=validateManifest(m);
    if(manifest.schema===1)return manifest; // Existing build 1008 remains installable during migration.
    if(!root.crypto?.subtle)throw Error('This browser cannot verify signed firmware releases.');
    if(!verifyKeyPromise)verifyKeyPromise=root.crypto.subtle.importKey('spki',b64bytes(SIGNING_PUBLIC_KEY_SPKI),
      {name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    const key=await verifyKeyPromise;
    const ok=await root.crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,b64bytes(manifest.signing.value),
      new TextEncoder().encode(canonicalManifest(manifest)));
    if(!ok)throw Error('Firmware publisher signature verification failed. Nothing was flashed.');
    return manifest;
  }
  function compatible(m,info,identity) {
    validateManifest(m);
    if(info.protocol!==3) throw Error(root.SynapOTA.MIGRATION_MESSAGE);
    if(info.state===0||info.capacity<m.size||info.maxData<64) throw Error('This pendant needs compatible OTA slots and BLE MTU before updating.');
    if(identity) {
      const parts=identity.split(':');
      if(parts.length!==4||parts[0]!=='SYNAP-FW'||parts[1]!==TARGET||Number(parts[3])!==info.build) throw Error('The connected pendant is a different hardware target.');
    } else throw Error('Unknown pendant hardware. Reconnect and check the firmware identity.');
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
    const parsed=JSON.parse(new TextDecoder().decode(await request(BASE+'latest.json?t='+Date.now(),8192,fetcher)));
    return verifyManifest(parsed);
  }
  async function download(m,capacity,fetcher,signal) {
    const manifest=await verifyManifest(m);if(manifest.size>capacity)throw Error('Firmware does not fit this pendant.');
    const bytes=await request(manifest.url,manifest.size,fetcher,signal);
    if(bytes.length!==manifest.size)throw Error('Firmware download is incomplete.');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==manifest.sha256)throw Error('Firmware download SHA-256 mismatch. Nothing was flashed.');
    root.SynapOTA.validateImage(bytes,capacity,3);
    const marker=new TextEncoder().encode(manifest.identity+'\0');
    let found=false;
    for(let i=0;i<=bytes.length-marker.length;i++){
      if(marker.every((b,j)=>bytes[i+j]===b)){found=true;break;}
    }
    if(!found)throw Error('Firmware image target/build does not match the release.');
    return new Blob([bytes],{type:'application/octet-stream'});
  }
  root.SynapReleases={TARGET,BASE,IDENTITY_UUID,LEGACY_UNSIGNED_MAX_BUILD,SIGNING_KEY_ID,SIGNING_PUBLIC_KEY_SPKI,
    canonicalManifest,validateManifest,verifyManifest,compatible,latest,download};
  if(typeof module!=='undefined')module.exports=root.SynapReleases;
})(globalThis);
