'use strict';
const fs=require('node:fs');

function replaceOnce(source,before,after,label){
  const i=source.indexOf(before);
  if(i<0) throw new Error(`Missing PWA audio-v2 anchor: ${label}`);
  if(source.indexOf(before,i+before.length)>=0) throw new Error(`Ambiguous PWA audio-v2 anchor: ${label}`);
  return source.slice(0,i)+after+source.slice(i+before.length);
}
function patchApp(source){
  let out=source;
  if(out.includes('const APP_REVISION = "1.0.0-audio2";')) return out;
  out=replaceOnce(out,'const APP_REVISION = "1.0.0-diag1";','const APP_REVISION = "1.0.0-audio2";','app revision');
  out=replaceOnce(out,
`  const MIN_CHUNKS_PER_FRAME = 10;\n  const MAX_CHUNKS_PER_FRAME = 20;`,
`  // Native protocol-v2 transport. The browser consumes exactly what firmware sends;\n  // there is no BLE event rewriting or synthetic re-segmentation layer.\n  const MIN_CHUNKS_PER_FRAME = 4;\n  const MAX_CHUNKS_PER_FRAME = 20;\n  const MAX_AUDIO_PAYLOAD_BYTES = 500;`,
  'native audio bounds');
  out=replaceOnce(out,'  const MAX_RECORDING_MS = 30 * 60 * 1000;','  const MAX_RECORDING_MS = 50 * 60 * 1000;','recording safety ceiling');
  out=replaceOnce(out,
`    if (receivedStatus.state === DEVICE_STATE.STREAMING &&\n        (receivedStatus.mtu < 91 || receivedStatus.chunksPerFrame < 10 ||\n         receivedStatus.chunksPerFrame > 20 || receivedStatus.payloadBytes < 80 ||\n         receivedStatus.payloadBytes > 160)) {`,
`    if (receivedStatus.state === DEVICE_STATE.STREAMING &&\n        (receivedStatus.mtu < 91 || receivedStatus.chunksPerFrame < MIN_CHUNKS_PER_FRAME ||\n         receivedStatus.chunksPerFrame > MAX_CHUNKS_PER_FRAME || receivedStatus.payloadBytes < 1 ||\n         receivedStatus.payloadBytes > MAX_AUDIO_PAYLOAD_BYTES ||\n         receivedStatus.payloadBytes + AUDIO_HEADER_BYTES > receivedStatus.attCapacity)) {`,
  'streaming status validation');
  out=replaceOnce(out,
`      payloadLength === 0 ||\n      payloadLength > 160 ||\n      AUDIO_HEADER_BYTES + payloadLength !== value.byteLength`,
`      payloadLength === 0 ||\n      payloadLength > MAX_AUDIO_PAYLOAD_BYTES ||\n      AUDIO_HEADER_BYTES + payloadLength !== value.byteLength`,
  'native payload validation');
  out=replaceOnce(out,
`      toast("30-minute limit reached. Saving recording.");`,
`      toast("Recording safety limit reached. Saving recording.");`,
  'duration copy');
  return out;
}
function patchTheme(source){
  let out=source;
  const marker='  // Firmware may now use 4-20 chunks/frame and up to 500-byte payloads when the';
  const start=out.indexOf(marker);
  if(start>=0){
    const end=out.indexOf("  if(typeof history!=='undefined'&&'scrollRestoration'in history)",start);
    if(end<0) throw new Error('Missing PWA audio-v2 anchor: theme history boundary');
    out=out.slice(0,start)+`  // Audio protocol parsing belongs to app.js. Do not intercept or rewrite Web Bluetooth\n  // characteristic events here: every valid firmware packet must reach the journal.\n\n`+out.slice(end);
  }
  out=out.replace("script('recording-bridge.js?v=1.0.0-touch1')","script('recording-bridge.js?v=1.0.0-touch2')");
  return out;
}
function patchWorker(source){
  let out=source;
  out=out.replace("const CLIENT_REVISION='1.0.0-audio1';","const CLIENT_REVISION='1.0.0-audio2';");
  out=out.replace("const CACHE_REVISION='1.0.0-shell20-audio-reliability';","const CACHE_REVISION='1.0.0-shell22-native-audio-v2';");
  return out;
}
function patchReconnectTest(source){
  return source
    .replace("assert.equal(reply.revision,'1.0.0-audio1')","assert.equal(reply.revision,'1.0.0-audio2')")
    .replace("assert.equal(reply.shellRevision,'1.0.0-shell20-audio-reliability')","assert.equal(reply.shellRevision,'1.0.0-shell22-native-audio-v2')");
}
function patchReliabilityTest(source){
  let out=source;
  out=out.replace("assert.match(sw,/CACHE_REVISION='1\\.0\\.0-shell20-audio-reliability'/);","assert.match(sw,/CACHE_REVISION='1\\.0\\.0-shell22-native-audio-v2'/);");
  const start=out.indexOf("test('Bluefy compatibility restores controls and bridges larger audio packets before app startup'");
  if(start>=0){
    const end=out.indexOf("\n\ntest('memory events remain",start);
    if(end<0) throw new Error('Missing reliability test boundary');
    const replacement=`test('native audio v2 consumes firmware packets without an EventTarget BLE translation shim',()=>{\n  const theme=fs.readFileSync(path.join(root,'theme.js'),'utf8');\n  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');\n  assert.match(theme,/typeof navigator!==['\"]undefined['\"]&&!navigator\\.locks/);\n  assert.match(theme,/synapLockFallback/);\n  assert.doesNotMatch(theme,/framesByTarget/);\n  assert.doesNotMatch(theme,/LEGACY_CHUNKS/);\n  assert.doesNotMatch(theme,/EventTarget\\.prototype|ET\\.prototype/);\n  assert.match(app,/MIN_CHUNKS_PER_FRAME = 4/);\n  assert.match(app,/MAX_AUDIO_PAYLOAD_BYTES = 500/);\n  assert.match(app,/payloadLength > MAX_AUDIO_PAYLOAD_BYTES/);\n  assert.match(app,/journal\\.append\\(currentRecordingId/);\n});`;
    out=out.slice(0,start)+replacement+out.slice(end);
  }
  return out;
}
function patchRecordingTest(source){
  return source.replace(/recording-bridge\\\.js\\\?v=1\\\.0\\\.0-touch1/g,'recording-bridge\\.js\\?v=1\\.0\\.0-touch2');
}
function main(){
  const files={
    'app.js':patchApp,
    'theme.js':patchTheme,
    'sw.js':patchWorker,
    'tests/reconnect.cjs':patchReconnectTest,
    'tests/reliability.cjs':patchReliabilityTest,
    'tests/recording-bridge.cjs':patchRecordingTest
  };
  for(const [file,fn] of Object.entries(files)){
    const before=fs.readFileSync(file,'utf8'),after=fn(before);
    if(after!==before){fs.writeFileSync(file,after);console.log('patched',file);} else console.log('unchanged',file);
  }
}
if(require.main===module)main();
module.exports={patchApp,patchTheme,patchWorker};
