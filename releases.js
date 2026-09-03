/* Production release feed for device-ID OTA: legacy ES256 + GitHub provenance migration. */
(function(root){
  'use strict';
  const TARGET='esp32s3-fh4r2-qspi-4m';
  const REPOSITORY='DivyanKavdia/synap-firmware';
  const RELEASE_BRANCH='ota-releases';
  const WORKFLOW='.github/workflows/firmware.yml';
  const BASE=`https://raw.githubusercontent.com/${REPOSITORY}/${RELEASE_BRANCH}/`;
  const API=`https://api.github.com/repos/${REPOSITORY}`;
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
    const github=m?.schema===3 && m.channel==='production';
    if(!m||(!legacy&&!signed&&!github)||m.target!==TARGET||m.protocol!==3||m.chip!==9||m.partition!=='default'||
      m.flashBytes!==4194304||m.psramBytes!==2097152||!integer(m.build,504,65535)||
      !integer(m.size,288,0x140000)||!/^\d+\.\d+\.\d+$/.test(m.version)||
      !/^[a-f0-9]{64}$/.test(m.sha256)||!/^[a-f0-9]{40}$/.test(m.commit)||
      m.identity!==`SYNAP-FW:${TARGET}:${m.version}:${m.build}`||
      m.url!==`${BASE}builds/${m.build}-${m.sha256}.bin`) throw Error('Invalid or incompatible firmware release manifest.');
    if(signed&&(!m.signing||m.signing.alg!=='ES256'||m.signing.keyId!==SIGNING_KEY_ID||
      !/^[A-Za-z0-9+/]{86}==$/.test(m.signing.value))) throw Error('Production firmware manifest is not signed by Synap.');
    if(github&&(m.signing||m.provenance?.provider!=='github-actions'||m.provenance?.repository!==REPOSITORY||m.provenance?.workflow!==WORKFLOW))
      throw Error('Production firmware manifest has invalid GitHub provenance metadata.');
    if(legacy&&(m.signing||m.provenance))throw Error('Legacy firmware manifest must not contain trust metadata.');
    return Object.freeze({...m,signing:m.signing?Object.freeze({...m.signing}):undefined,provenance:m.provenance?Object.freeze({...m.provenance}):undefined});
  }
  async function boundedResponse(response,limit) {
    if(!response.ok) throw Error(`Firmware server returned HTTP ${response.status}.`);
    if(Number(response.headers.get('content-length'))>limit) throw Error('Firmware response exceeds size limit.');
    const reader=response.body?.getReader();
    if(!reader){const b=new Uint8Array(await response.arrayBuffer());if(b.length>limit)throw Error('Firmware response exceeds size limit.');return b;}
    const chunks=[];let length=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error('Firmware response exceeds size limit.');chunks.push(value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    const result=new Uint8Array(length);let offset=0;for(const b of chunks){result.set(b,offset);offset+=b.length;}return result;
  }
  async function request(url,limit,fetcher=root.fetch.bind(root),signal){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    try{if(signal?.aborted)controller.abort();return await boundedResponse(await fetcher(url,{cache:'no-store',credentials:'omit',redirect:'error',headers:{Accept:'application/vnd.github+json'},signal:controller.signal}),limit);}
    finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  const json=async(url,limit,fetcher)=>JSON.parse(new TextDecoder().decode(await request(url,limit,fetcher)));
  let verifyKeyPromise=null;
  async function verifyLegacySignature(manifest){
    if(!root.crypto?.subtle)throw Error('This browser cannot verify signed firmware releases.');
    if(!verifyKeyPromise)verifyKeyPromise=root.crypto.subtle.importKey('spki',b64bytes(SIGNING_PUBLIC_KEY_SPKI),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    const key=await verifyKeyPromise;const ok=await root.crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,b64bytes(manifest.signing.value),new TextEncoder().encode(canonicalManifest(manifest)));
    if(!ok)throw Error('Firmware publisher signature verification failed. Nothing was flashed.');
  }
  async function verifyGitHubProvenance(manifest,fetcher=root.fetch.bind(root)){
    const tip=await json(`${API}/commits/${RELEASE_BRANCH}?t=${Date.now()}`,262144,fetcher);
    if(!tip?.commit?.verification?.verified||tip.commit.verification.reason!=='valid')throw Error('Firmware release commit is not verified by GitHub. Nothing was flashed.');
    if(tip.author?.login!=='github-actions[bot]'||tip.commit?.committer?.name!=='GitHub')throw Error('Firmware release was not published by GitHub Actions. Nothing was flashed.');
    if(tip.commit?.message!==`Publish production build ${manifest.build}`)throw Error('Firmware release commit does not match the advertised build.');
    if(!/^[a-f0-9]{40}$/.test(tip.sha))throw Error('Invalid GitHub release commit identity.');
    const file=await json(`${API}/contents/latest.json?ref=${tip.sha}`,65536,fetcher);
    if(file?.encoding!=='base64'||typeof file.content!=='string')throw Error('GitHub could not bind the release manifest to its verified commit.');
    const bound=JSON.parse(new TextDecoder().decode(b64bytes(file.content.replace(/\s/g,''))));
    if(canonicalManifest(bound)!==canonicalManifest(manifest)||JSON.stringify(bound.provenance)!==JSON.stringify(manifest.provenance))throw Error('Verified GitHub release commit does not contain this firmware manifest.');
    const att=await json(`${API}/attestations/sha256:${manifest.sha256}`,262144,fetcher);
    if(!Array.isArray(att?.attestations)||att.attestations.length===0)throw Error('Firmware build provenance attestation is missing. Nothing was flashed.');
  }
  async function verifyManifest(m,fetcher){const manifest=validateManifest(m);if(manifest.schema===1)return manifest;if(manifest.schema===2)await verifyLegacySignature(manifest);else await verifyGitHubProvenance(manifest,fetcher);return manifest;}
  function compatible(m,info,identity){validateManifest(m);if(info.protocol!==3)throw Error(root.SynapOTA.MIGRATION_MESSAGE);if(info.state===0||info.capacity<m.size||info.maxData<64)throw Error('This pendant needs compatible OTA slots and BLE MTU before updating.');if(identity){const parts=identity.split(':');if(parts.length!==4||parts[0]!=='SYNAP-FW'||parts[1]!==TARGET||Number(parts[3])!==info.build)throw Error('The connected pendant is a different hardware target.');}else throw Error('Unknown pendant hardware. Reconnect and check the firmware identity.');return m.build>info.build;}
  async function latest(fetcher=root.fetch.bind(root)){const parsed=await json(BASE+'latest.json?t='+Date.now(),8192,fetcher);return verifyManifest(parsed,fetcher);}
  async function download(m,capacity,fetcher=root.fetch.bind(root),signal){const manifest=await verifyManifest(m,fetcher);if(manifest.size>capacity)throw Error('Firmware does not fit this pendant.');const bytes=await request(manifest.url,manifest.size,fetcher,signal);if(bytes.length!==manifest.size)throw Error('Firmware download is incomplete.');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==manifest.sha256)throw Error('Firmware download SHA-256 mismatch. Nothing was flashed.');root.SynapOTA.validateImage(bytes,capacity,3);const marker=new TextEncoder().encode(manifest.identity+'\0');let found=false;for(let i=0;i<=bytes.length-marker.length;i++){if(marker.every((b,j)=>bytes[i+j]===b)){found=true;break;}}if(!found)throw Error('Firmware image target/build does not match the release.');return new Blob([bytes],{type:'application/octet-stream'});}
  root.SynapReleases={TARGET,REPOSITORY,RELEASE_BRANCH,WORKFLOW,BASE,API,IDENTITY_UUID,LEGACY_UNSIGNED_MAX_BUILD,SIGNING_KEY_ID,SIGNING_PUBLIC_KEY_SPKI,canonicalManifest,validateManifest,verifyManifest,verifyGitHubProvenance,compatible,latest,download};
  if(typeof module!=='undefined')module.exports=root.SynapReleases;
})(globalThis);
