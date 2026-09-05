'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
function replaceOnce(source,before,after,label){
  const i=source.indexOf(before);
  if(i<0)throw new Error(`Missing final power-state anchor: ${label}`);
  if(source.indexOf(before,i+before.length)>=0)throw new Error(`Ambiguous final power-state anchor: ${label}`);
  return source.slice(0,i)+after+source.slice(i+before.length);
}
let app=fs.readFileSync(path.join(root,'app.js'),'utf8');
app=replaceOnce(app,
`      finalizing = false;
      if (saveError) {
        setAppState("error", "Audio is still in memory. Download it before reloading.");
      } else if (!isGattConnected()) {
        setAppState("disconnected");
      } else if (deviceStatus.state === DEVICE_STATE.CONNECTED_IDLE &&
                 deviceStatus.error === 0) {
        setAppState("idle");
      } else {
        setAppState("error", "Pendant is not idle. Disconnect and reconnect to recover.");
      }`,
`      finalizing = false;
      if (saveError) {
        setAppState("error", "Audio is still in memory. Download it before reloading.");
      } else if (document.body.dataset.synapPowerState === "deep-sleep") {
        setAppState("deep-sleep", "Tap the pendant once to wake it.");
      } else if (deviceStatus.state === DEVICE_STATE.STANDBY && isGattConnected()) {
        setAppState("standby");
      } else if (!isGattConnected()) {
        setAppState("disconnected");
      } else if (deviceStatus.state === DEVICE_STATE.CONNECTED_IDLE &&
                 deviceStatus.error === 0) {
        setAppState("idle");
      } else {
        setAppState("error", "Pendant is not idle. Disconnect and reconnect to recover.");
      }`,
'finalization power state');
fs.writeFileSync(path.join(root,'app.js'),app);
let test=fs.readFileSync(path.join(root,'tests/power-controls-v2.cjs'),'utf8');
const marker=`assert.match(app,/deepSleep \\? "deep-sleep" : "disconnected"/);`;
if(!test.includes(marker))throw new Error('Missing power-controls test marker');
test=test.replace(marker,marker+`\nassert.match(app,/dataset\\.synapPowerState === "deep-sleep"[\\s\\S]*?setAppState\\("deep-sleep"/,'recording finalization must preserve intentional deep sleep');\nassert.match(app,/DEVICE_STATE\\.STANDBY && isGattConnected\\(\\)[\\s\\S]*?setAppState\\("standby"/,'recording finalization must preserve BLE standby');`);
fs.writeFileSync(path.join(root,'tests/power-controls-v2.cjs'),test);
console.log('Finalized Synap PWA power-state handling');
