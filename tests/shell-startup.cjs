const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'runtime-ui.js'),'utf8');
const theme=fs.readFileSync(path.join(root,'theme.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const brandCss=fs.readFileSync(path.join(root,'settings-icon-fix.css'),'utf8');

test('new launch is canonical and always starts at the top',()=>{
  const listeners={};
  const domListeners={};
  const location={pathname:'/synap-pwa/',search:'?installed=1',hash:'#library'};
  const history={state:{x:1},scrollRestoration:'auto',replaceState(state,title,url){this.state=state;this.url=url;location.hash='';}};
  const documentElement={scrollTop:420,attrs:new Set(),hasAttribute(k){return this.attrs.has(k)},toggleAttribute(k,v){if(v)this.attrs.add(k);else this.attrs.delete(k)}};
  const body={scrollTop:420};
  const scrollingElement={scrollTop:420};
  let scrollY=420;
  const document={
    readyState:'loading',documentElement,body,scrollingElement,
    getElementById(){return null},querySelector(){return null},
    addEventListener(type,fn){domListeners[type]=fn}
  };
  class MutationObserver{constructor(fn){this.fn=fn}observe(){}}
  const window={
    addEventListener(type,fn){listeners[type]=fn},
    scrollTo(x,y){scrollY=y},
    matchMedia(){return{matches:false,addEventListener(){}}}
  };
  const context={window,document,location,history,MutationObserver,requestAnimationFrame:fn=>{fn();return 1},setTimeout:fn=>{fn();return 1},console};
  vm.createContext(context);
  vm.runInContext(runtime,context);
  assert.equal(history.scrollRestoration,'manual');
  assert.equal(location.hash,'');
  assert.equal(history.url,'/synap-pwa/?installed=1');
  assert.equal(scrollingElement.scrollTop,0);
  assert.equal(documentElement.scrollTop,0);
  assert.equal(body.scrollTop,0);
  assert.equal(scrollY,0);

  location.hash='#ask';
  listeners.hashchange();
  assert.equal(location.hash,'','runtime fragments are removed after an intentional in-app jump');

  location.hash='#insights';
  scrollingElement.scrollTop=documentElement.scrollTop=body.scrollTop=275;
  scrollY=275;
  listeners.pageshow({persisted:true});
  assert.equal(location.hash,'');
  assert.equal(scrollingElement.scrollTop,0);
  assert.equal(scrollY,0,'bfcache restore returns to the top');
});

test('section navigation does not persist fragments for the next launch',()=>{
  assert.match(runtime,/event\.preventDefault\(\)/);
  assert.match(runtime,/section\.scrollIntoView\(/);
  assert.match(runtime,/window\.addEventListener\('hashchange',[^\n]*stripFragment/);
  assert.match(theme,/location\.hash/);
  assert.match(theme,/history\.replaceState\(history\.state,'',location\.pathname\+location\.search\)/);
});

test('Home and Settings use one wordmark and one dark-mode rule',()=>{
  const home=html.match(/class="brand-logo synap-brand-image"\s+src="([^"]+)"/);
  const settings=html.match(/class="synap-brand-image settings-brand-logo"\s+src="([^"]+)"/);
  assert(home&&settings,'both wordmarks must exist');
  assert.equal(settings[1],home[1],'Settings must use the exact Home source asset');
  assert.match(brandCss,/:root\[data-theme="dark"\] \.synap-brand-image\s*\{[\s\S]*filter:brightness\(0\) invert\(1\)!important/);
  assert.doesNotMatch(brandCss,/:root\[data-theme="dark"\][^{]*settings-brand-logo\s*\{[^}]*filter:none/);
  assert.match(runtime,/settingsLogo\.classList\.add\('synap-brand-image'\)/);
});

console.log('PASS: startup position, fragment hygiene and Home/Settings brand parity');
