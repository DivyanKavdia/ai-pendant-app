// node tests/ota-ui.cjs — real app handlers in a minimal DOM, no browser required.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const block=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
function setup({legacy=false,fail=false}={}) {
  const nodes=new Map(),calls=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,checked:false,files:[],value:0,textContent:'',events:{},
    classList:{add(){}},addEventListener(t,f){this.events[t]=f;}});return nodes.get(id);};
  let connected=true;
  class Client {
    constructor(io){this.io=io;}
    reset(){calls.push('reset');}
    cancel(){calls.push('cancel');}
    async check(){calls.push('check');if(legacy)throw new Error('Install by USB');return{build:501,capacity:2048,state:2};}
    async update(){calls.push('update');assert(c.firmwareBusy);assert(c.ui.startButton.disabled);assert(c.ui.connectButton.disabled);
      this.io.progress('Sending',0.5,false);assert.equal(node('otaCancel').disabled,false);
      if(fail)throw new Error('Flash failed');this.io.progress('Committing',1,true);assert(node('otaCancel').disabled);
      connected=false;return{sha256:'test'};}
  }
  const c={console,Date,Promise,Error,globalThis:{SynapOTA:{Client}},document:{getElementById:node,body:{dataset:{}}},
    ui:new Proxy({},{get:(_,key)=>node(key)}),firmwareBusy:false,firmwareUpdater:null,
    appState:'idle',deviceStatus:{error:0},connectInProgress:false,recordingConfirmed:false,finalizing:false,
    currentRecordingId:null,openingCapture:null,unsavedAudio:false,isGattConnected:()=>connected,
    queueGattOperation:async f=>f(),gattServer:{getPrimaryService:async()=>({})},SERVICE_UUID:'service',
    clearReconnectTimer:()=>calls.push('clearReconnect'),processor:{pause:()=>calls.push('pause')},
    friendlyError:e=>e.message,log(){},acquireWakeLock:async()=>calls.push('wake'),releaseWakeLock:async()=>calls.push('release'),
    delay:async()=>{},recoverRememberedConnection:()=>calls.push('reconnect'),bluetoothDevice:{},needsDeviceSelection:false};
  vm.createContext(c);
  vm.runInContext(block('  function setAppState(','  function updateMetrics(')+
    block('  function bindFirmwareUpdate()','  async function registerServiceWorker()'),c);
  c.bindFirmwareUpdate();
  return{c,calls,node,click:id=>node(id).events.click(),disconnect:()=>connected=false};
}
(async()=>{
  let t=setup();await t.click('otaCheck');assert.match(t.node('otaStatus').textContent,/501/);assert(!t.c.firmwareBusy);
  assert.equal(t.c.ui.startButton.disabled,false);assert.equal(t.c.ui.connectButton.disabled,false);
  for(const flag of ['recordingConfirmed','finalizing','currentRecordingId','openingCapture','unsavedAudio','connectInProgress']) {
    t=setup();t.c[flag]=true;await t.click('otaCheck');assert(!t.calls.includes('check'),flag);
  }
  t=setup({legacy:true});await t.click('otaCheck');assert.match(t.node('otaStatus').textContent,/USB/);assert.equal(t.c.appState,'idle');
  t=setup();await t.click('otaStart');assert(!t.calls.includes('update'));assert.equal(t.c.firmwareBusy,false);
  for(const fail of [false,true]) {
    t=setup({fail});t.node('otaFile').files=[{name:'app.bin'}];t.node('otaConfirm').checked=true;
    await t.click('otaStart');assert(t.calls.includes('pause'));assert(t.calls.includes('update'));assert(t.calls.includes('release'));
    assert.equal(t.c.firmwareBusy,false);assert.equal(t.node('otaConfirm').checked,false);assert(t.node('otaCancel').disabled);
    if(fail)assert.match(t.node('otaStatus').textContent,/Flash failed/);else assert(t.calls.includes('reconnect'));
  }
  t=setup();t.c.firmwareBusy=true;t.c.setAppState('idle');assert(t.c.ui.startButton.disabled);assert(t.c.ui.stopButton.disabled);
  await t.click('otaStart');assert(!t.calls.includes('update'));
  // OTA owns a wake lock even without an active recording session.
  let released=0;const lock={release:async()=>released++,addEventListener(){}};
  const c={navigator:{wakeLock:{request:async()=>lock}},wakeLock:null,firmwareBusy:true,recordingSessionId:0,
    isCurrentSession:()=>false,appState:'updating',log(){},friendlyError:e=>e.message};vm.createContext(c);
  vm.runInContext(block('  async function acquireWakeLock()','  async function releaseWakeLock()'),c);
  await c.acquireWakeLock();assert.equal(c.wakeLock,lock);assert.equal(released,0);
  c.wakeLock=null;c.firmwareBusy=false;await c.acquireWakeLock();assert.equal(released,1);
  // FIFO cannot resume or start a job after OTA takes ownership during a storage await.
  require('../audio-store.js');let allowed=false,processed=0,heads=0;
  const store={head:async()=>{heads++;return null;}};
  let fifo=new globalThis.DKFIFOProcessor(store,{canRun:()=>allowed,settings:()=>({}),locks:{request:async(n,o,f)=>f({})}});
  await fifo.resume();assert.equal(heads,0);assert.equal(fifo.paused,true);
  let resolveHead;store.head=()=>new Promise(resolve=>resolveHead=resolve);allowed=true;
  const running=fifo.resume();await Promise.resolve();allowed=false;fifo.pause();resolveHead({id:1});
  fifo.process=async()=>processed++;await running;assert.equal(processed,0);
  let resolveSegment,uploads=0;allowed=true;
  fifo=new globalThis.DKFIFOProcessor({get:()=>new Promise(resolve=>resolveSegment=resolve)},
    {canRun:()=>allowed,fetch:async()=>uploads++,settings:()=>({})});
  fifo.paused=false;
  const pending=fifo.process({kind:'summarize',recordingId:'r',segmentIndex:0},{},'https://example.test/summary');
  allowed=false;fifo.pause();resolveSegment({transcript:'test'});
  await assert.rejects(pending,{name:'AbortError'});assert.equal(uploads,0,'no upload after an awaited storage read');
  console.log('PASS: OTA UI eligibility/locks, legacy recovery, errors, commit, reconnect, wake lock and FIFO ownership race.');
})().catch(error=>{console.error(error);process.exitCode=1;});
