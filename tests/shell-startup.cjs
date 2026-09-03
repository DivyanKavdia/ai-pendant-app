const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'runtime-ui.js'),'utf8');
const theme=fs.readFileSync(path.join(root,'theme.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const brandCss=fs.readFileSync(path.join(root,'settings-icon-fix.css'),'utf8');

test('startup fix is isolated from the restored runtime UI',()=>{
  assert.match(theme,/scrollRestoration='manual'/);
  assert.match(theme,/location\.hash/);
  assert.match(theme,/history\.replaceState\(history\.state,'',location\.pathname\+location\.search\)/);
  assert.doesNotMatch(runtime,/enforceStartupPosition/);
  assert.doesNotMatch(runtime,/stripFragment/);
  assert.doesNotMatch(runtime,/section\.scrollIntoView/);
  assert.match(runtime,/nav\.addEventListener\('click',event=>\{const link=event\.target\.closest\('a\[href\^="#"\]'\);if\(link\)select\(link\)\}\)/);
});

test('restored Home and Settings wordmarks retain pre-consolidation styling',()=>{
  const home=html.match(/class="brand-logo synap-brand-image"\s+src="([^"]+)"/);
  const settings=html.match(/class="synap-brand-image settings-brand-logo"\s+src="([^"]+)"/);
  assert(home&&settings,'both wordmarks must exist');
  assert.equal(settings[1],home[1]);
  assert.match(brandCss,/:root\[data-theme="dark"\] \.pendant-settings-top \.settings-brand-logo[\s\S]*brightness\(0\) invert\(1\)!important/);
  assert.match(runtime,/bindSettingsBrand/);
  assert.match(runtime,/home-wordmark/);
});

console.log('PASS: pre-consolidation runtime restored with isolated startup guard');
