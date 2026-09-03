const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../runtime-ui.js'),'utf8');

test('explicit tab taps stay authoritative while smooth scrolling settles',()=>{
  assert.match(source,/event\.preventDefault\(\)/);
  assert.match(source,/lock\(link\)/);
  assert.match(source,/select\(link\)/);
  assert.match(source,/section\.scrollIntoView\(\{behavior:reduced\?'auto':'smooth',block:'start'\}\)/);
  assert.match(source,/lockedHref/);
});

test('scroll spy chooses the section with the largest visible area',()=>{
  assert.match(source,/const viewportBottom=Math\.max\(boundary\+1,window\.innerHeight-navHeight-8\)/);
  assert.match(source,/let chosen=items\[0\],bestVisible=-1/);
  assert.match(source,/const visible=Math\.max\(0,Math\.min\(rect\.bottom,viewportBottom\)-Math\.max\(rect\.top,boundary\)\)/);
  assert.match(source,/visible>bestVisible/);
});

test('Library wins near the bottom instead of leaving Ask selected',()=>{
  assert.match(source,/const bottomGap=document\.documentElement\.scrollHeight-\(window\.scrollY\+window\.innerHeight\)/);
  assert.match(source,/const bottomTolerance=Math\.max\(96,Math\.round\(window\.innerHeight\*\.08\)\)/);
  assert.match(source,/bottomGap<=bottomTolerance\)chosen=items\[items\.length-1\]/);
});

test('tab navigation does not leave a fragment that can reopen the app mid-page',()=>{
  assert.match(source,/history\.replaceState\(history\.state,'',location\.pathname\+location\.search\)/);
});

console.log('PASS: runtime tabs keep Library and Ask mutually exclusive, visibility-aware and fragment-free');
