// node tests/ota-ui.cjs — real app handlers in a minimal DOM, no browser required.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const block=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
(async()=>{
  // The sole update route is the verified release flow, tested in releases-ui.
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

  for(const id of ['otaFile','otaConfirm','otaStart','otaCheck','setupInstallationId','setupSavedDevices']) {
    assert(!html.includes('id="'+id+'"'),id+' is removed');
    assert(!source.includes('getElementById("'+id+'")'),id+' has no stale handler');
  }
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:'',classList:{add(){}}});return nodes.get(id);};
  const locked={firmwareBusy:true,appState:'idle',document:{body:{dataset:{}}},ui:new Proxy({},{get:(_,k)=>node(k)})};
  vm.createContext(locked);vm.runInContext(block('  function setAppState(','  function updateMetrics('),locked);
  locked.setAppState('idle');assert(locked.ui.startButton.disabled);assert(locked.ui.stopButton.disabled);assert(locked.ui.connectButton.disabled);
  // The compact connection card must preserve actionable update failures on disconnect.
  const stateNodes=new Map();const stateNode=id=>{if(!stateNodes.has(id))stateNodes.set(id,{textContent:'',hidden:false,disabled:false,dataset:{}});return stateNodes.get(id);};
  let connected=false;
  const card={appState:'disconnected',firmwareBusy:false,connectInProgress:false,recordingConfirmed:false,finalizing:false,currentRecordingId:null,
    isGattConnected:()=>connected,document:{getElementById:stateNode},ui:{chooseDeviceButton:stateNode('chooseDeviceButton')}};
  vm.createContext(card);vm.runInContext(block('  function renderDeviceSetup()','  function openSettings()'),card);
  stateNode('otaStatus').textContent='Update paused · Reconnect to continue';card.renderDeviceSetup();
  assert.match(stateNode('otaStatus').textContent,/Update paused/);assert.equal(stateNode('setupDeviceStatus').textContent,'Not connected');
  stateNode('otaStatus').textContent='Up to date · 1008';card.renderDeviceSetup();assert.equal(stateNode('otaStatus').textContent,'Connect to check');
  connected=true;card.appState='recording';card.recordingConfirmed=true;card.renderDeviceSetup();
  assert.equal(stateNode('setupDeviceStatus').textContent,'Recording');assert(stateNode('setupConnect').hidden);assert(card.ui.chooseDeviceButton.disabled);
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
  console.log('PASS: OTA-only controls, recording locks, wake lock and FIFO ownership race.');
})().catch(error=>{console.error(error);process.exitCode=1;});
