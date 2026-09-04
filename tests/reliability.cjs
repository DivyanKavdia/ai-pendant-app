const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');require('../audio-store.js');const codec=globalThis.DKAudioCodec;
function packet(sequence,chunk,total,payload){return{sequence,chunk,total,payload:new Uint8Array(payload)}}
function fullFrame(sequence){const packets=[];for(let i=0;i<10;i++)packets.push(packet(sequence,i,10,160));return packets}

test('timeline assembly preserves missing frame positions as silence',()=>{
  const packets=[...fullFrame(0),...fullFrame(2)],compact=codec.assemble(packets,{preserveTimeline:true,startSequence:0,endSequence:2});
  assert.equal(compact.completeFrames,2);assert.equal(compact.frames.length,3);assert.equal(compact.missing,1);
  assert(compact.frames[1].every(b=>b===0));assert.equal(codec.wav(compact.frames).size,44+3*1600);
});

test('timeline can preserve outages spanning an entire 30-second segment',()=>{
  const packets=[...fullFrame(0),...fullFrame(1200)],compact=codec.assemble(packets,{preserveTimeline:true,startSequence:0,endSequence:1200});
  assert.equal(compact.completeFrames,2);assert.equal(compact.frames.length,1201);assert.equal(compact.missing,1199);
  const source=fs.readFileSync(path.join(root,'audio-store.js'),'utf8');assert.match(source,/lastIndex=Math\.floor\(lastSequence\/SEGMENT_FRAMES\)/);assert.match(source,/for\(let index=0;index<=lastIndex;index\+\+\)/);
});

test('duplicate chunks do not falsely make a complete frame',()=>{
  const packets=fullFrame(5);packets.push(packet(5,0,10,160));const result=codec.assemble(packets);assert.equal(result.completeFrames,1);assert.equal(result.incomplete,0);
  const broken=codec.assemble(packets.filter(p=>p.chunk!==9));assert.equal(broken.completeFrames,0);assert.equal(broken.incomplete,1);
});

test('failed recording does not block a different recording in scheduler',async()=>{
  const store=new globalThis.DKAudioStore();store.all=async()=>[{id:1,recordingId:'a',state:'failed',nextAt:0},{id:2,recordingId:'a',state:'pending',nextAt:0},{id:3,recordingId:'b',state:'pending',nextAt:0,kind:'transcribe',segmentIndex:0}];
  const selected=await store.nextRunnable(100);assert.equal(selected.job.id,3);assert.equal(selected.blockedCount,1);
});

test('PWA uses dedicated BLE EVENT channel without global EventTarget interception',()=>{
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const touch=fs.readFileSync(path.join(root,'touch-event-bridge.js'),'utf8');
  const events=fs.readFileSync(path.join(root,'event-channel.js'),'utf8');
  const memoryFix=fs.readFileSync(path.join(root,'memory-ui-fix.js'),'utf8');
  assert.match(sw,/CACHE_REVISION='1\.0\.0-shell15-event-channel'/);
  assert.match(sw,/\.\/event-channel\.js/);
  assert.match(touch,/event-channel\.js\?v=1\.0\.0-event1/);
  assert.doesNotMatch(touch,/EventTarget\?\.prototype/);
  assert.doesNotMatch(touch,/__synapInteractionBridge/);
  assert.match(events,/EVENT_UUID='4fa1234e-0000-1000-8000-00805f9b34fb'/);
  assert.match(events,/CONTROL_UUID='4fa12347-0000-1000-8000-00805f9b34fb'/);
  assert.match(events,/getCharacteristic\(EVENT_UUID\)/);
  assert.match(events,/mode:'event'/);
  assert.match(events,/mode:'legacy-control'/);
  assert.match(events,/startNotifications\(\)/);
  assert.match(events,/characteristic\.readValue\(\)/);
  assert.match(events,/SynapMemoryEventBridge\?\.inspect/);
  assert.doesNotMatch(memoryFix,/installBatteryBleHook/);
});

test('memory events remain stream-relative and reboot-safe',()=>{
  const touch=fs.readFileSync(path.join(root,'touch-event-bridge.js'),'utf8');
  assert.match(touch,/relative=Boolean\(flags&4\)/);
  assert.match(touch,/streamOffsetMs:relative\?eventTime:null/);
  assert.match(touch,/pendantEventKey===detail\.eventKey/);
  assert.match(touch,/pendantStreamOffsetMs:Number\.isFinite\(detail\.streamOffsetMs\)/);
  assert.doesNotMatch(touch,/lastCounter/);
  assert.doesNotMatch(touch,/h\.source==='pendant'&&h\.counter===detail\.counter/);
});

test('battery UX stays percentage-first and voltage is diagnostics-only',()=>{
  const touch=fs.readFileSync(path.join(root,'touch-event-bridge.js'),'utf8');
  assert.match(touch,/Sensor unavailable/);assert.match(touch,/receivedAt:Date\.now\(\)/);
  assert.match(touch,/Detailed electrical readings remain available in Diagnostics/);
  assert.doesNotMatch(touch,/<span>Voltage<\/span>/);assert.doesNotMatch(touch,/<span>Low threshold<\/span>/);
});

test('production release trust remains GitHub provenance based',()=>{
  const releases=fs.readFileSync(path.join(root,'releases.js'),'utf8');
  assert.match(releases,/LEGACY_UNSIGNED_MAX_BUILD=1008/);assert.match(releases,/SIGNING_KEY_ID='prod-2026-01'/);
  assert.match(releases,/crypto\.subtle\.verify/);assert.match(releases,/schema===3/);assert.match(releases,/github-actions/);
  assert.match(releases,/verifyGitHubProvenance\(manifest\)\{validateManifest\(manifest\);return true;\}/);
});
