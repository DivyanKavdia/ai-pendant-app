'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
function replaceOnce(source,before,after,label){
  const i=source.indexOf(before);
  if(i<0)throw new Error(`Missing PWA power anchor: ${label}`);
  if(source.indexOf(before,i+before.length)>=0)throw new Error(`Ambiguous PWA power anchor: ${label}`);
  return source.slice(0,i)+after+source.slice(i+before.length);
}
function write(name,content){fs.writeFileSync(path.join(root,name),content)}

function patchApp(){
  let s=fs.readFileSync(path.join(root,'app.js'),'utf8');
  s=replaceOnce(s,
`  const CMD_GET_STATUS = 0x02;`,
`  const CMD_GET_STATUS = 0x02;
  const CMD_STANDBY = 0x03;
  const CMD_WAKE = 0x04;`,
  'power commands');
  s=replaceOnce(s,
`    STREAMING: 2,
    ERROR: 3
  };`,
`    STREAMING: 2,
    ERROR: 3,
    STANDBY: 4
  };`,
  'standby device state');
  s=replaceOnce(s,
`    if (nextState === "starting") {`,
`    if (nextState === "standby") {
      ui.connectionBadge.classList.add("status-ready");
      ui.connectionText.textContent = "Standby";
      ui.connectButtonLabel.textContent = "Disconnect";
      ui.startButton.disabled = true;
      ui.stopButton.disabled = true;
      ui.recorderTitle.textContent = "Pendant in standby.";
      ui.recorderSubtitle.textContent = "Wake it from Settings or tap the pendant once.";
      ui.levelText.textContent = "Bluetooth standby · microphone paused";
      return;
    }

    if (nextState === "deep-sleep") {
      ui.connectionBadge.classList.add("status-offline");
      ui.connectionText.textContent = "Deep sleep";
      ui.connectButtonLabel.textContent = "Reconnect after wake";
      ui.startButton.disabled = true;
      ui.stopButton.disabled = true;
      ui.recorderTitle.textContent = "Pendant is sleeping.";
      ui.recorderSubtitle.textContent = "Tap the pendant once to wake it.";
      ui.levelText.textContent = "Bluetooth off in deep sleep";
      return;
    }

    if (nextState === "starting") {`,
  'standby/deep-sleep UI states');
  s=replaceOnce(s,
`    if (receivedStatus.state > 3 || receivedStatus.headerBytes !== AUDIO_HEADER_BYTES ||`,
`    if (receivedStatus.state > 4 || receivedStatus.headerBytes !== AUDIO_HEADER_BYTES ||`,
  'status state range');
  s=replaceOnce(s,
`    if (deviceStatus.state === DEVICE_STATE.CONNECTED_IDLE) {`,
`    if (deviceStatus.state === DEVICE_STATE.STANDBY) {
      clearStartTimeout();
      if (recordingConfirmed || appState === "starting" || appState === "stopping") {
        scheduleFinalize(0, "standby", recordingSessionId);
      }
      setAppState("standby");
      return true;
    }

    if (deviceStatus.state === DEVICE_STATE.CONNECTED_IDLE) {`,
  'standby status handling');
  s=replaceOnce(s,
`      if (
        deviceStatus.state === DEVICE_STATE.CONNECTED_IDLE &&
        deviceStatus.error === 0
      ) {`,
`      if (
        (deviceStatus.state === DEVICE_STATE.CONNECTED_IDLE ||
         deviceStatus.state === DEVICE_STATE.STANDBY) &&
        deviceStatus.error === 0
      ) {`,
  'standby connection acknowledgement');
  s=replaceOnce(s,
`        setAppState("idle");
        if (!silent) toast("Pendant connected");`,
`        setAppState(deviceStatus.state === DEVICE_STATE.STANDBY ? "standby" : "idle");
        if (!silent) toast(deviceStatus.state === DEVICE_STATE.STANDBY ? "Pendant connected in standby" : "Pendant connected");`,
  'standby connection UI');
  s=replaceOnce(s,
`    setAppState(
      "disconnected",
      manualDisconnect
        ? "Pendant disconnected."
        : "Connection was lost. Tap Reconnect to continue."
    );

    if (!manualDisconnect) {
      toast("Pendant connection lost", "error");
      scheduleAutoReconnect();
    }`,
`    const deepSleep = document.body.dataset.synapPowerState === "deep-sleep";
    setAppState(
      deepSleep ? "deep-sleep" : "disconnected",
      deepSleep
        ? "Tap the pendant once to wake it."
        : manualDisconnect
          ? "Pendant disconnected."
          : "Connection was lost. Tap Reconnect to continue."
    );

    if (!manualDisconnect && !deepSleep) {
      toast("Pendant connection lost", "error");
      scheduleAutoReconnect();
    }`,
  'deep-sleep disconnect handling');
  write('app.js',s);
}

function patchTheme(){
  let s=fs.readFileSync(path.join(root,'theme.js'),'utf8');
  s=replaceOnce(s,
`    script('ai-providers.js?v=0.0.1-brain3');script('recording-bridge.js?v=1.0.0-touch3');`,
`    script('ai-providers.js?v=0.0.1-brain3');script('recording-bridge.js?v=1.0.0-touch4');script('power-controls.js?v=1.0.0-power1');`,
  'power controls loader');
  write('theme.js',s);
}

function patchBridge(){
  let s=fs.readFileSync(path.join(root,'recording-bridge.js'),'utf8');
  s=replaceOnce(s,
`      hint.textContent = 'Touch: hold 2s to start · double tap to stop · hold 5s to sleep/wake';`,
`      hint.textContent = 'Touch: double tap to start/stop · hold 5s for deep sleep · single tap wakes';`,
  'touch guidance v4');
  write('recording-bridge.js',s);
}

function patchWorker(){
  let s=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  s=replaceOnce(s,
`/* Touch guidance aligned with the 2s start / double-tap stop / 5s sleep-wake firmware. */
const CACHE_REVISION='1.0.0-shell27-touch3';`,
`/* Power controls v2: double-tap capture, true deep sleep and BLE standby. */
const CACHE_REVISION='1.0.0-shell28-power1';`,
  'worker revision');
  s=replaceOnce(s,
`  './app.js','./enhancements.js','./capture-ui.js','./brain-ui.js','./product-ui.js','./runtime-ui.js',`,
`  './app.js','./enhancements.js','./capture-ui.js','./brain-ui.js','./product-ui.js','./runtime-ui.js','./power-controls.js',`,
  'power controls cache entry');
  write('sw.js',s);
}

function patchTests(){
  const dir=path.join(root,'tests');
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.cjs'))){
    const file=path.join(dir,name);let s=fs.readFileSync(file,'utf8');
    s=s.replaceAll('shell27-touch3','shell28-power1');
    s=s.replaceAll('shell27\\-touch3','shell28\\-power1');
    s=s.replaceAll('1\\.0\\.0-shell27-touch3','1\\.0\\.0-shell28-power1');
    s=s.replaceAll('recording-bridge\\.js\\?v=1\\.0\\.0-touch3','recording-bridge\\.js\\?v=1\\.0\\.0-touch4');
    s=s.replaceAll('Touch: hold 2s to start · double tap to stop · hold 5s to sleep\\/wake','Touch: double tap to start\\/stop · hold 5s for deep sleep · single tap wakes');
    s=s.replaceAll('touch3 copy','touch4 power-controls copy');
    fs.writeFileSync(file,s);
  }
}

patchApp();patchTheme();patchBridge();patchWorker();patchTests();
console.log('Applied Synap PWA power controls v2');
