const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'theme.js'),'utf8');
function setup({saved=null,dark=false,blocked=false}={}){
  const storage=new Map(saved?[['synap-appearance',saved]]:[]),events={},media={matches:dark,addEventListener(t,f){this.change=f;}};
  const buttons=['system','light','dark'].map(value=>({dataset:{themeChoice:value},attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(t,f){this.click=f;}}));
  const html={dataset:{},style:{}},meta={setAttribute(k,v){this[k]=v;}};
  const c={document:{documentElement:html,readyState:'complete',querySelector:()=>meta,querySelectorAll:()=>buttons},
    window:{matchMedia:()=>media,addEventListener(t,f){events[t]=f;}},localStorage:{getItem:k=>{if(blocked)throw Error('blocked');return storage.get(k);},setItem:(k,v)=>{if(blocked)throw Error('blocked');storage.set(k,v);}}};
  vm.runInNewContext(source,c);return {html,meta,buttons,media,storage,events};
}
let t=setup({dark:true});assert.equal(t.html.dataset.theme,'dark');assert.equal(t.meta.content,'#091426');
t.buttons[1].click();assert.equal(t.html.dataset.theme,'light');assert.equal(t.storage.get('synap-appearance'),'light');
t.media.matches=true;t.media.change();assert.equal(t.html.dataset.theme,'light','explicit choice overrides system');
t.buttons[0].click();assert.equal(t.html.dataset.theme,'dark');t.media.matches=false;t.media.change();assert.equal(t.html.dataset.theme,'light');
assert.equal(t.buttons.filter(b=>b.attributes['aria-pressed']==='true').length,1);
assert.equal(setup({saved:'dark'}).html.dataset.theme,'dark');
assert.equal(setup({saved:'invalid',dark:true}).html.dataset.theme,'dark');
t=setup({blocked:true});t.buttons[2].click();assert.equal(t.html.dataset.theme,'dark','blocked storage does not block switching');
t.events.storage({key:'synap-appearance',newValue:'light'});assert.equal(t.html.dataset.theme,'light');
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
const values=block=>Object.fromEntries([...block.matchAll(/--([\w-]+):([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
const light=values(css.match(/:root\{([^}]+)\}/)[1]);
const dark={...light,...values(css.match(/:root\[data-theme="dark"\]\{([^}]+)\}/)[1])};
function color(theme,name){const v=theme[name];assert(v,'missing '+name);return v.startsWith('var(')?color(theme,v.slice(6,-1)):v;}
function lum(hex){const c=hex.slice(1).match(/../g).slice(0,3).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
const pairs=[['ink','surface'],['ink','bg'],['muted','surface'],['muted','surface-2'],['accent','accent-soft'],['success','success-soft'],['rose','rose-soft'],['amber','amber-soft'],['on-action','action'],['on-action','action-hover'],['on-rose','rose'],['console-text','console']];
for(const [mode,theme] of Object.entries({light,dark})){
  let minimum=100;
  for(const [fg,bg] of pairs){const a=lum(color(theme,fg)),b=lum(color(theme,bg)),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);minimum=Math.min(minimum,ratio);assert(ratio>=4.5,`${mode} ${fg}/${bg}: ${ratio.toFixed(2)}`);}
  for(const fg of ['control-border','switch-off']){const a=lum(color(theme,fg)),b=lum(color(theme,'surface'));assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=3,`${mode} control contrast`);}
  console.log(`${mode}: ${pairs.length} semantic text pairs pass; minimum ${minimum.toFixed(2)}:1`);
}
console.log('PASS: theme selection, persistence, system changes, blocked storage and color contrast');
