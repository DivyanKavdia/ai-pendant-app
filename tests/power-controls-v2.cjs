'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const power=fs.readFileSync(path.join(root,'power-controls.js'),'utf8');
const theme=fs.readFileSync(path.join(root,'theme.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'recording-bridge.js'),'utf8');

assert.match(app,/CMD_STANDBY = 0x03/);
assert.match(app,/CMD_WAKE = 0x04/);
assert.match(app,/STANDBY: 4/);
assert.match(app,/receivedStatus\.state > 4/);
assert.match(app,/nextState === "standby"/);
assert.match(app,/nextState === "deep-sleep"/);
assert.match(app,/deviceStatus\.state === DEVICE_STATE\.STANDBY/);
assert.match(app,/dataset\.synapPowerState === "deep-sleep"/);
assert.match(app,/deepSleep \? "deep-sleep" : "disconnected"/);

assert.match(power,/CMD_STANDBY=0x03/);
assert.match(power,/CMD_WAKE=0x04/);
assert.match(power,/POWER_EVENT_MAGIC=0xE2/);
assert.match(power,/Deep sleep · tap the pendant once to wake/);
assert.match(power,/Standby · Bluetooth is available for remote wake/);
assert.match(power,/sendPower\(CMD_STANDBY\)/);
assert.match(power,/sendPower\(CMD_WAKE\)/);
assert.match(power,/synap-event-packet/);
assert.match(power,/synap-gatt-service-ready/);
assert.doesNotMatch(power,/Wake pendant[\s\S]*deep-sleep.*sendPower\(CMD_WAKE\)/,'true deep sleep must not pretend BLE wake is possible');

assert.match(theme,/power-controls\.js\?v=1\.0\.0-power1/);
assert.match(theme,/recording-bridge\.js\?v=1\.0\.0-touch4/);
assert.match(sw,/CACHE_REVISION='1\.0\.0-shell28-power1'/);
assert.match(sw,/\.\/power-controls\.js/);
assert.match(bridge,/Touch: double tap to start\/stop · hold 5s for deep sleep · single tap wakes/);

console.log('PASS: PWA distinguishes true deep sleep from BLE-wakeable standby and exposes remote wake only for standby.');
