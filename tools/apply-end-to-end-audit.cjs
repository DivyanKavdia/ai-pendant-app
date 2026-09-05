'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function read(name){return fs.readFileSync(path.join(root,name),'utf8')}
function write(name,text){fs.writeFileSync(path.join(root,name),text)}
function replaceOnce(source,before,after,label){const i=source.indexOf(before);if(i<0)throw Error(`Missing PWA audit anchor: ${label}`);if(source.indexOf(before,i+before.length)>=0)throw Error(`Ambiguous PWA audit anchor: ${label}`);return source.slice(0,i)+after+source.slice(i+before.length)}
function patchApp(source){let s=source;
  if(!s.includes('const MIN_STREAM_MTU = 32;')){
    s=replaceOnce(s,'  const MIN_CHUNKS_PER_FRAME = 4;','  const MIN_CHUNKS_PER_FRAME = 1;','minimum audio chunks');
    s=replaceOnce(s,'  const START_TIMEOUT_MS = 5000;\n  const COMMAND_TIMEOUT_MS = 3500;',`  const START_TIMEOUT_MS = 5000;\n  const COMMAND_TIMEOUT_MS = 3500;\n  const MIN_STREAM_MTU = 32;\n  const AUDIO_STALL_TIMEOUT_MS = 12000;\n  const FOREGROUND_STALL_GRACE_MS = 3000;`,'mobile audio constants');
    s=replaceOnce(s,'  let lastAudioAt = 0;','  let lastAudioAt = 0;\n  let foregroundAt = performance.now();','foreground clock');
    s=replaceOnce(s,`    document.addEventListener("visibilitychange", function () {\n      if (document.visibilityState === "visible") recoverRememberedConnection("foreground", false);\n    });`,`    document.addEventListener("visibilitychange", function () {\n      if (document.visibilityState !== "visible") return;\n      foregroundAt = performance.now();\n      recoverRememberedConnection("foreground", false);\n      if (isGattConnected() && !connectInProgress && !firmwareBusy && !finalizing) {\n        readControlStatus().then(ok=>{if(ok) log("Foreground pendant status resynchronised");});\n      }\n    });`,'foreground status resync');
    const start=s.indexOf('  function handleAudioNotification(event) {');
    const end=s.indexOf('\n  function observeSequence(sequence) {',start);
    if(start<0||end<0)throw Error('Missing PWA audit anchor: audio handler');
    const block=s.slice(start,end),prefix='  function handleAudioNotification(event) {\n    const value = event.target.value;\n';
    if(!block.startsWith(prefix))throw Error('Unexpected PWA audio handler shape');
    let inner=block.slice(prefix.length);const cut=inner.lastIndexOf('\n  }');
    if(cut<0)throw Error('Missing PWA audio handler close');inner=inner.slice(0,cut);
    const replacement=`  function handleAudioNotification(event) {\n    const original = event?.target?.value;\n    const normalizer = globalThis.SynapAudioCodecV3?.normalizePacket;\n    const values = typeof normalizer === "function"\n      ? normalizer(original, event?.target || audioCharacteristic)\n      : [original];\n    for (const value of values) handleNormalizedAudioValue(value);\n  }\n\n  function handleNormalizedAudioValue(value) {${inner}\n  }`;
    s=s.slice(0,start)+replacement+s.slice(end);
    s=replaceOnce(s,'(receivedStatus.mtu < 91 || receivedStatus.chunksPerFrame < MIN_CHUNKS_PER_FRAME ||','(receivedStatus.mtu < MIN_STREAM_MTU || receivedStatus.chunksPerFrame < MIN_CHUNKS_PER_FRAME ||','stream MTU floor');
    s=replaceOnce(s,'      recordingConfirmed = true;\n      recordingStartedAt = performance.now();\n      lastAudioAt = recordingStartedAt;','      recordingConfirmed = true;\n      recordingStartedAt = performance.now();\n      foregroundAt = recordingStartedAt;\n      lastAudioAt = recordingStartedAt;','recording foreground clock');
    s=replaceOnce(s,`    if (appState === "recording" && performance.now() - lastAudioAt > 7000) {\n      log("Audio stalled for seven seconds; stopping safely");\n      toast("Audio stopped arriving. Saving what was received.", "error");\n      stopRecording();\n    }`,`    const now = performance.now();\n    if (appState === "recording" && document.visibilityState === "visible" &&\n        now - foregroundAt > FOREGROUND_STALL_GRACE_MS &&\n        now - lastAudioAt > AUDIO_STALL_TIMEOUT_MS) {\n      log("Audio stalled while foregrounded; stopping safely", {\n        stalledMs: Math.round(now-lastAudioAt), session: recordingSessionId\n      });\n      toast("Audio stream stalled. Saving what was received.", "error");\n      stopRecording();\n    }`,'foreground-safe stall watchdog');
    s=replaceOnce(s,`  function saveSettings() {\n    const endpoint = ui.endpointInput.value.trim();\n    const llmEndpoint = ui.llmEndpointInput.value.trim();\n    if (llmEndpoint && new URL(llmEndpoint).protocol !== "https:") {\n      toast("Use an HTTPS LLM endpoint.", "error");return false;\n    }\n    if (endpoint && new URL(endpoint).protocol !== "https:") {\n      toast("Use an HTTPS transcription endpoint.", "error");\n      return false;\n    }`,`  function validHttpsEndpoint(value) {\n    if (!value) return true;\n    try { return new URL(value).protocol === "https:"; }\n    catch (_) { return false; }\n  }\n\n  function saveSettings() {\n    const endpoint = ui.endpointInput.value.trim();\n    const llmEndpoint = ui.llmEndpointInput.value.trim();\n    if (!validHttpsEndpoint(llmEndpoint)) {\n      toast("Use a valid HTTPS LLM endpoint.", "error");return false;\n    }\n    if (!validHttpsEndpoint(endpoint)) {\n      toast("Use a valid HTTPS transcription endpoint.", "error");\n      return false;\n    }`,'safe endpoint validation');
  }
  return s;
}
function patchEvent(source){if(!source.includes("script.src='audio-codec-v3.js"))return source;const a=source.indexOf('function loadAudioCodec(){'),b=source.indexOf('\nfunction packetBytes',a);if(a<0||b<0)throw Error('Missing event codec loader');return source.slice(0,a)+"function loadAudioCodec(){root.SynapAudioCodecV3?.install?.();}\n"+source.slice(b+1)}
function main(){
  write('app.js',patchApp(read('app.js')));
  write('event-channel.js',patchEvent(read('event-channel.js')));
  let s=read('recording-bridge.js').replace('Touch: tap to start/stop · hold to remember','Touch: hold ~1s to start · deliberate tap to stop · hold to remember');write('recording-bridge.js',s);
  s=read('sw.js').replace("const CACHE_REVISION='1.0.0-shell25-bluefy-direct-audio';","const CACHE_REVISION='1.0.0-shell26-end-to-end-audio';");write('sw.js',s);
  s=read('enhancements.js').replace("const SHELL_REVISION='1.0.0-prod9'","const SHELL_REVISION='1.0.0-shell26-end-to-end-audio'").replace('(e.data.revision||e.data.version)===SHELL_REVISION','e.data.shellRevision===SHELL_REVISION');write('enhancements.js',s);
}
if(require.main===module)main();
module.exports={patchApp,patchEvent};
