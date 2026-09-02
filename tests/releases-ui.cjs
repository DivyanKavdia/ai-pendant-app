const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const source=app.slice(app.indexOf('  function bindFirmwareUpdate()'),app.indexOf('  async function registerServiceWorker()'));
function setup(options={}){
  const nodes=new Map(),events={},calls=[],storage=new Map();let connected=true,clock=100000,build=503;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',files:[],disabled:false,checked:false,hidden:false,textContent:'',events:{},
    addEventListener(t,f){(this.events[t]??=[]).push(f);}});return nodes.get(id);};
  const m={version:'1.0.0',build:1001,identity:'SYNAP-FW:esp32s3-fh4r2-qspi-4m:1.0.0:1001'};
  const key={type:'secret'},vault={get:async()=>options.noKey?null:key,put:async()=>calls.push('remember'),forget:async()=>calls.push('forget')};
  class Client {
    constructor(io){this.io=io;this.committing=false;}reset(){}cancel(){calls.push('cancel');}
    async check(){calls.push('check');return{protocol:2,state:1,build,capacity:2048,maxData:173};}
    async update(blob,k){assert.equal(k,key);assert(c.firmwareBusy);calls.push('flash');
      if(options.flashFail)throw Error('Flash failed');
      this.committing=true;connected=false;
      if(options.commitDrop)throw Error('Lost acknowledgement');return{committed:true};}
  }
  const releases={IDENTITY_UUID:'identity',OwnerVault:class{constructor(){return vault;}},validateManifest:m=>m,
    latest:async()=>{calls.push('manifest');if(options.offline)throw Error('Offline');return m;},
    compatible:(m,info)=>m.build>info.build,
    download:async()=>{calls.push('download');if(options.badDownload)throw Error('SHA-256 mismatch');
      if(options.disconnectDownload){connected=false;c.connectionEpoch++;}return{};}};
  const c={console,Promise,Error,TextDecoder,AbortController,Date:{now:()=>clock},globalThis:{SynapOTA:{Client,importOwnerKey:async()=>key},SynapReleases:releases},
    document:{getElementById:node,visibilityState:'visible',addEventListener(t,f){events[t]=f;}},window:{confirm:()=>options.decline?false:true},
    ui:{chooseDeviceButton:node('choose'),runQueueButton:node('queue')},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    firmwareUpdater:null,firmwareBusy:false,checkFirmwareRelease:null,connectionEpoch:0,bluetoothDevice:{id:'device',gatt:{disconnect:()=>connected=false}},
    isGattConnected:()=>connected,connectInProgress:false,recordingConfirmed:false,finalizing:false,currentRecordingId:null,openingCapture:null,unsavedAudio:false,
    appState:'idle',deviceStatus:{error:0},SERVICE_UUID:'service',queueGattOperation:f=>f(),
    gattServer:{getPrimaryService:async()=>({getCharacteristic:async()=>{
      if(build===503)throw Object.assign(Error('missing'),{name:'NotFoundError'});
      return{readValue:async()=>new TextEncoder().encode(m.identity)};
    }})},
    clearReconnectTimer(){},setAppState(){},friendlyError:e=>e.message,processor:{pause:()=>calls.push('pause')},
    log(){},openSettings:()=>calls.push('settings'),acquireWakeLock:async()=>{},releaseWakeLock:async()=>calls.push('release'),
    delay:async ms=>clock+=ms,setInterval:f=>events.timer=f,
    connectPendant:async()=>{calls.push('reconnect');if(!options.reconnectFail){connected=true;build=options.oldBuild?503:1001;}},
    recoverRememberedConnection:()=>calls.push('recover')};
  vm.createContext(c);vm.runInContext(source,c);c.bindFirmwareUpdate();
  return {c,node,calls,storage,click:async id=>{for(const fn of node(id).events.click||[])await fn();},tick:()=>events.timer()};
}
(async()=>{
  let t=setup();await t.click('otaReleaseCheck');assert.match(t.node('firmwareNoticeText').textContent,/1001.*available/);
  t.node('otaRemember').checked=true;await t.click('firmwareUpdateButton');
  assert(t.calls.includes('flash'));assert(t.calls.includes('remember'));assert(t.calls.includes('reconnect'));assert.match(t.node('otaStatus').textContent,/Update complete/);assert.equal(t.storage.size,0);assert(!t.c.firmwareBusy);
  t=setup({commitDrop:true});await t.click('otaReleaseCheck');await t.click('otaLatest');assert.match(t.node('otaStatus').textContent,/Update complete/);
  for(const options of [{decline:true},{noKey:true},{badDownload:true},{disconnectDownload:true}]){
    t=setup(options);await t.click('otaReleaseCheck');await t.click('otaLatest');assert(!t.calls.includes('flash'),JSON.stringify(options));assert(!t.c.firmwareBusy);
  }
  for(const flag of ['recordingConfirmed','finalizing','currentRecordingId','openingCapture','unsavedAudio','connectInProgress']){
    t=setup();await t.click('otaReleaseCheck');t.c[flag]=true;await t.click('otaLatest');assert(!t.calls.includes('flash'),flag);
  }
  t=setup({oldBuild:true});await t.click('otaReleaseCheck');await t.click('otaLatest');assert.match(t.node('otaStatus').textContent,/not confirmed/);assert.equal(t.storage.size,1);
  t=setup({reconnectFail:true});await t.click('otaReleaseCheck');await t.click('otaLatest');assert.match(t.node('otaStatus').textContent,/not confirmed/);assert(t.calls.includes('recover'));
  t=setup({offline:true});await t.click('otaReleaseCheck');assert(!t.calls.includes('flash'));assert.match(t.node('otaStatus').textContent,/Offline/);
  t=setup();await t.click('otaForget');assert(t.calls.includes('forget'));
  console.log('PASS: automatic update discovery, approval, authorization, eligibility, hash failure, connection race, commit loss, reboot verification and failure retention.');
})().catch(e=>{console.error(e);process.exitCode=1;});
