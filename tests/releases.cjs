const {test}=require('node:test'),assert=require('node:assert/strict'),cryptoNode=require('node:crypto');
const ota=require('../ota.js'),r=require('../releases.js');
function fixture(){
  const bytes=Buffer.alloc(512);bytes[0]=0xe9;bytes.writeUInt16LE(9,12);bytes.writeUInt32LE(0xabcd5432,32);
  bytes.write('SYNAP-ESP32S3-OTA-AUTH-V2',80);
  const identity=`SYNAP-FW:${r.TARGET}:1.0.0:1001`;bytes.write(identity+'\0',160);
  const sha256=cryptoNode.createHash('sha256').update(bytes).digest('hex');
  const m={schema:1,target:r.TARGET,protocol:2,chip:9,partition:'default',flashBytes:4194304,psramBytes:2097152,
    build:1001,version:'1.0.0',size:bytes.length,sha256,identity,commit:'a'.repeat(40),url:r.BASE+`builds/1001-${sha256}.bin`};
  return {bytes,m};
}
test('release manifest rejects other targets, untrusted URLs, invalid builds and oversized images',()=>{
  const {m}=fixture();assert.equal(r.validateManifest(m).build,1001);
  for(const [key,value] of [['target','esp32'],['url','https://evil.test/firmware.bin'],['build',65536],['size',0x140001],['sha256','bad'],['protocol',1],['partition','huge_app'],['identity','wrong']]){
    assert.throws(()=>r.validateManifest({...m,[key]:value}),/manifest/,key);
  }
  const info={protocol:2,state:1,capacity:2048,maxData:173,build:503};
  assert(r.compatible(m,info,null),'explicit baseline 503 migration');
  assert.throws(()=>r.compatible(m,{...info,build:502},null),/Unknown/);
  assert.throws(()=>r.compatible(m,info,'SYNAP-FW:other:1.0.0:503'),/hardware/);
  assert.throws(()=>r.compatible(m,{...info,capacity:100},null),/slots/);
  assert.equal(r.compatible(m,{...info,build:1001},m.identity),false,'no repeat install');
  assert.equal(r.compatible(m,{...info,build:1002},m.identity.replace('1001','1002')),false,'no automatic downgrade');
});
test('download verifies bounded size, digest, image header and exact build before flashing',async()=>{
  const {bytes,m}=fixture();let options;
  const fetcher=async(url,opts)=>{assert.equal(url,m.url);options=opts;return new Response(bytes);};
  const blob=await r.download(m,2048,fetcher);assert.equal(blob.size,512);
  assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
  await assert.rejects(r.download(m,2048,async()=>new Response(bytes.subarray(0,500))),/incomplete/);
  await assert.rejects(r.download(m,2048,async()=>new Response(Buffer.alloc(513))),/size limit/);
  await assert.rejects(r.download(m,2048,async()=>new Response(Buffer.alloc(512))),/SHA-256/);
  await assert.rejects(r.download(m,2048,async()=>new Response('',{status:404})),/HTTP 404/);
  const bad=Buffer.from(bytes);bad[0]=0;
  const sha256=cryptoNode.createHash('sha256').update(bad).digest('hex');
  await assert.rejects(r.download({...m,sha256,url:r.BASE+`builds/1001-${sha256}.bin`},2048,async()=>new Response(bad)),/application/);
  const other=Buffer.from(bytes);other.write('1002',160+m.identity.length-4);
  const hash=cryptoNode.createHash('sha256').update(other).digest('hex');
  await assert.rejects(r.download({...m,sha256:hash,url:r.BASE+`builds/1001-${hash}.bin`},2048,async()=>new Response(other)),/target\/build/);
  assert.equal((await r.latest(async()=>new Response(JSON.stringify(m)))).build,1001);
});
test('non-extractable owner key survives structured clone and remains device-scoped in vault',async()=>{
  const key=await ota.importOwnerKey('a1'.repeat(32));assert(ota.isOwnerKey(key));
  await assert.rejects(crypto.subtle.exportKey('raw',key));
  const cloned=structuredClone(key);assert(ota.isOwnerKey(cloned));
  const begin=ota.packet(1,9,73);await ota.authorize(begin,new DataView(new ArrayBuffer(16)),cloned);
  const expected=cryptoNode.createHmac('sha256',Buffer.from('a1'.repeat(32),'hex')).update('SYNAP-OTA-V2').update(Buffer.alloc(16)).update(begin.subarray(0,41)).digest();
  assert.deepEqual(Buffer.from(begin.subarray(41)),expected);
  const saved=new Map(),vault=new r.OwnerVault();
  vault.open=async()=>({close(){},transaction(){
    const tx={objectStore:()=>({get:id=>request(()=>structuredClone(saved.get(id))),
      put:(value,id)=>request(()=>saved.set(id,structuredClone(value))),delete:id=>request(()=>saved.delete(id))})};
    function request(action){const req={};setImmediate(()=>{req.result=action();tx.oncomplete();});return req;}return tx;
  }});
  await vault.put('pendant-a',key);assert(ota.isOwnerKey(await vault.get('pendant-a')));assert.equal(await vault.get('pendant-b'),null);
  await vault.forget('pendant-a');assert.equal(await vault.get('pendant-a'),null);
  await assert.rejects(vault.put('pendant-a','plaintext'),/non-extractable/);
});
