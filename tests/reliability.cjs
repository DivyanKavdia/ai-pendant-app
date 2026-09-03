const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
require('../audio-store.js');
const codec=globalThis.DKAudioCodec;
function packet(sequence,chunk,total,payload){return{sequence,chunk,total,payload:new Uint8Array(payload)};}
function fullFrame(sequence){const packets=[];for(let i=0;i<10;i++)packets.push(packet(sequence,i,10,160));return packets;}
test('timeline assembly preserves missing frame positions as silence',()=>{
  const packets=[...fullFrame(0),...fullFrame(2)];
  const compact=codec.assemble(packets,{preserveTimeline:true,startSequence:0,endSequence:2});
  assert.equal(compact.completeFrames,2);assert.equal(compact.frames.length,3);assert.equal(compact.missing,1);
  assert.equal(compact.frames[1].byteLength,1600);assert(compact.frames[1].every(b=>b===0));
  assert.equal(codec.wav(compact.frames).size,44+3*1600);
});
test('timeline can preserve outages spanning an entire 30-second segment',()=>{
  const packets=[...fullFrame(0),...fullFrame(1200)];
  const compact=codec.assemble(packets,{preserveTimeline:true,startSequence:0,endSequence:1200});
  assert.equal(compact.completeFrames,2);assert.equal(compact.frames.length,1201);assert.equal(compact.missing,1199);
  const source=fs.readFileSync(path.join(root,'audio-store.js'),'utf8');
  assert.match(source,/lastIndex=Math\.floor\(lastSequence\/SEGMENT_FRAMES\)/);
  assert.match(source,/for\(let index=0;index<=lastIndex;index\+\+\)/);
});
test('duplicate chunks do not falsely make a complete frame',()=>{
  const packets=fullFrame(5);packets.push(packet(5,0,10,160));
  const result=codec.assemble(packets);assert.equal(result.completeFrames,1);assert.equal(result.incomplete,0);
  const broken=codec.assemble(packets.filter(p=>p.chunk!==9));assert.equal(broken.completeFrames,0);assert.equal(broken.incomplete,1);
});
test('failed recording does not block a different recording in the scheduler',async()=>{
  const store=new globalThis.DKAudioStore();
  store.all=async()=>[
    {id:1,recordingId:'a',state:'failed',nextAt:0},
    {id:2,recordingId:'a',state:'pending',nextAt:0},
    {id:3,recordingId:'b',state:'pending',nextAt:0,kind:'transcribe',segmentIndex:0}
  ];
  const selected=await store.nextRunnable(100);assert.equal(selected.job.id,3);assert.equal(selected.blockedCount,1);
});
test('production shell includes reliability UX, pendant health, forced OTA and provenance cache migration and browser-only storage copy',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),enhancements=fs.readFileSync(path.join(root,'enhancements.js'),'utf8');
  assert.match(html,/Saved in browser/);assert.doesNotMatch(html,/>On-device</);
  assert.match(html,/enhancements\.js\?v=1\.0\.0-prod2/);assert.match(sw,/APP_REVISION = "1\.0\.0-prod5"/);assert.match(sw,/enhancements\.js\?v=1\.0\.0-prod2/);
  assert.match(sw,/OTA_ASSET = "\.\/ota\.js\?v=1\.0\.0-ota4"/);assert.match(sw,/RELEASES_ASSET = "\.\/releases\.js\?v=1\.0\.0-prov1"/);
  assert.match(sw,/url\.pathname === otaUrl\.pathname/);assert.match(sw,/url\.pathname === releasesUrl\.pathname/);
  assert.match(enhancements,/Search your memory/);assert.match(enhancements,/System status/);assert.match(enhancements,/Download log/);
  assert.match(enhancements,/4fa1234d-0000-1000-8000-00805f9b34fb/);assert.match(enhancements,/Pendant health/);
  assert.match(enhancements,/captureDrops/);assert.match(enhancements,/notifyRejects/);assert.match(enhancements,/minFreeHeap/);assert.match(enhancements,/Brownout/);
});
test('production firmware supports legacy publisher signatures and keyless GitHub provenance',()=>{
  const releases=fs.readFileSync(path.join(root,'releases.js'),'utf8');
  assert.match(releases,/LEGACY_UNSIGNED_MAX_BUILD=1008/);assert.match(releases,/SIGNING_KEY_ID='prod-2026-01'/);
  assert.match(releases,/crypto\.subtle\.verify/);assert.match(releases,/schema===3/);assert.match(releases,/github-actions/);
  assert.match(releases,/attestations\/sha256:/);assert.match(releases,/verification\?\.verified/);
});
