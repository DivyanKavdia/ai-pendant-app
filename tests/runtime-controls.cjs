'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runtime=fs.readFileSync(path.join(__dirname,'..','runtime-ui.js'),'utf8');
const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');

assert.match(runtime,/installBlobRegistry\(\)/,'runtime must retain object-url to Blob mapping for synchronous export');
assert.match(runtime,/\^\(load audio\|play\)\$/i,'legacy duplicate Play/Load audio action must be recognized');
assert.match(runtime,/load\.hidden=true/,'lazy loader must be hidden so the native audio player is the single playback affordance');
assert.match(runtime,/data-synap-export/,'recording export must be intercepted before the legacy async download path');
assert.match(runtime,/navigator\.share/,'mobile export should use the native share sheet when file sharing is supported');
assert.match(runtime,/window\.open\(url,'_blank','noopener'\)/,'iOS fallback must open the prepared WAV while the tap activation is still live');
assert.match(runtime,/anchor\.download=name/,'desktop export must keep direct WAV download');
assert.match(runtime,/touch-action:manipulation/,'tap targets must opt out of delayed double-tap handling');
assert.match(runtime,/min-height:44px/,'primary controls must meet the minimum mobile tap target');
assert.match(sw,/shell24-audio-v3-loader/,'service worker cache must advance with the production audio-v3 loader');
console.log('runtime recording controls and tap responsiveness: ok');
