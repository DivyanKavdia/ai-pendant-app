const {test}=require('node:test'),assert=require('node:assert/strict'),cryptoNode=require('node:crypto');
const ota=require('../ota.js'),r=require('../releases.js');
function fixture(build=1001){
  const bytes=Buffer.alloc(512);bytes[0]=0xe9;bytes.writeUInt16LE(9,12);bytes.writeUInt32LE(0xabcd5432,32);
  bytes.write('SYNAP-ESP32S3-OTA-ID-V3',80);
  const identity=`SYNAP-FW:${r.TARGET}:1.0.0:${build}`;bytes.write(identity+'\0',160);
  const sha256=cryptoNode.createHash('sha256').update(bytes).digest('hex');
  const m={schema:1,target:r.TARGET,protocol:3,chip:9,partition:'default',flashBytes:4194304,psramBytes:2097152,
    build,version:'1.0.0',size:bytes.length,sha256,identity,commit:'a'.repeat(40),url:r.BASE+`builds/${build}-${sha256}.bin`};
  return {bytes,m};
}
test('release manifest rejects other targets, untrusted URLs, invalid builds and oversized images',()=>{
  const {m}=fixture();assert.equal(r.validateManifest(m).build,1001);
  for(const [key,value] of [['target','esp32'],['url','https://evil.test/firmware.bin'],['build',65536],['size',0x140001],['sha256','bad'],['protocol',1],['partition','huge_app'],['identity','wrong']]){
    assert.throws(()=>r.validateManifest({...m,[key]:value}),/manifest/,key);
  }
  const info={protocol:3,state:1,capacity:2048,maxData:173,build:1000};
  const board='SYNAP-FW:'+r.TARGET+':1.0.0:1000';
  assert(r.compatible(m,info,board));
  assert.throws(()=>r.compatible(m,{...info,protocol:2},board),/USB once/);
  assert.throws(()=>r.compatible(m,info,null),/Unknown/);
  assert.throws(()=>r.compatible(m,info,'SYNAP-FW:other:1.0.0:503'),/hardware/);
  assert.throws(()=>r.compatible(m,{...info,capacity:100},null),/slots/);
  assert.equal(r.compatible(m,{...info,build:1001},m.identity),false,'no repeat install');
  assert.equal(r.compatible(m,{...info,build:1002},m.identity.replace('1001','1002')),false,'no automatic downgrade');
});
test('unsigned legacy feed is accepted only through deployed build 1008',async()=>{
  assert.equal((await r.verifyManifest(fixture(1008).m)).build,1008);
  const future=fixture(1009).m;
  assert.throws(()=>r.validateManifest(future),/manifest/);
  const signedShape={...future,schema:2,channel:'production',signing:{alg:'ES256',keyId:r.SIGNING_KEY_ID,value:'A'.repeat(86)+'=='}};
  assert.equal(r.validateManifest(signedShape).schema,2);
  await assert.rejects(r.verifyManifest(signedShape),/signature/);
  assert.throws(()=>r.validateManifest({...signedShape,channel:'test'}),/manifest/);
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
test('device-ID targeting remains independent of owner keys while publisher authenticity is signed',()=>{
  assert.equal(r.OwnerVault,undefined);assert.equal(ota.importOwnerKey,undefined);
  assert.equal(r.SIGNING_KEY_ID,'prod-2026-01');assert.match(r.SIGNING_PUBLIC_KEY_SPKI,/^[A-Za-z0-9+/=]+$/);
});
