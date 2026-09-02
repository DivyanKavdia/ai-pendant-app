const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createController, loadFirebaseAdapter, isConfigured, messageFor } = require('../auth.js');
const root = path.join(__dirname, '..');
const config = { firebase: { apiKey:'test-public-key', authDomain:'test.firebaseapp.com', projectId:'test', appId:'test-app' }, providers:{google:true,apple:true} };
const member = {uid:'verified-user', displayName:'Sam', email:'relay@privaterelay.appleid.com'};
function harness({settings=config, user=null, allowed=true, online=true, loadError=false} = {}) {
  const calls=[], views=[];
  let callback, popupError, signOutError, finish;
  const adapter = {
    currentUser: () => user,
    subscribe: listener => { callback=listener; return () => {callback=null;}; },
    signIn: provider => { calls.push(provider); if(popupError)return Promise.reject(popupError); return new Promise(resolve => {finish=()=>{user=member;callback(user);resolve();};}); },
    signOut: async () => {calls.push('signOut');if(signOutError)throw signOutError;user=null;callback(user);}
  };
  const controller=createController({config:settings,loadAdapter:async()=>{calls.push('load');if(loadError)throw Error('offline');return adapter;},render:s=>views.push(s),canSignIn:()=>allowed,online:()=>online});
  return {controller,calls,views,finish:()=>finish(),change:u=>{user=u;callback(u);},failPopup:code=>popupError={code},failSignOut:()=>signOutError=Error('failed'),recover:()=>loadError=false};
}
async function controllers() {
  assert.equal(isConfigured(null),false);
  assert.equal(isConfigured({...config,firebase:{...config.firebase,apiKey:''}}),false);
  let h=harness({settings:null});await h.controller.start();await h.controller.signIn('google');assert.deepEqual(h.calls,[]);assert.equal(h.controller.snapshot().status,'unavailable');
  h=harness({user:member});await h.controller.start();assert.equal(h.controller.snapshot().user.uid,member.uid);
  h.change(null);assert.equal(h.controller.snapshot().user,null,'cross-tab sign-out removes the profile');
  h.change(member);assert.equal(h.controller.snapshot().user.email,member.email,'Apple relay email is preserved');
  h.failSignOut();await h.controller.signOut();assert.equal(h.controller.snapshot().user.uid,member.uid,'failed sign-out must not claim success');
  for (const provider of ['google','apple']) {
    h=harness();await h.controller.start();
    const login=h.controller.signIn(provider);
    assert.equal(h.calls.at(-1),provider,'popup is invoked before the first await');
    await h.controller.signIn(provider);assert.equal(h.calls.filter(x=>x===provider).length,1,'duplicate taps do not create another popup');
    assert.equal(h.controller.snapshot().user,null,'pending login must not create a profile');
    h.finish();await login;assert.equal(h.controller.snapshot().user.uid,member.uid);assert.equal(h.controller.snapshot().busy,false);
    await h.controller.signOut();assert.equal(h.controller.snapshot().user,null);
  }
  h=harness({settings:{...config,providers:{google:true,apple:false}}});await h.controller.start();await h.controller.signIn('apple');assert.deepEqual(h.calls,['load']);
  h=harness({allowed:false});await h.controller.start();await h.controller.signIn('google');assert.deepEqual(h.calls,['load']);assert.match(h.controller.snapshot().message,/Finish recording/);
  h=harness({online:false});await h.controller.start();await h.controller.signIn('google');assert.deepEqual(h.calls,['load']);assert.match(h.controller.snapshot().message,/internet/);
  for(const code of ['auth/popup-closed-by-user','auth/popup-blocked','auth/account-exists-with-different-credential','auth/network-request-failed']) {
    h=harness();await h.controller.start();h.failPopup(code);await h.controller.signIn('google');assert.equal(h.controller.snapshot().user,null);assert.equal(h.controller.snapshot().busy,false);assert.equal(h.controller.snapshot().message,messageFor({code}));
  }
  assert(!messageFor({message:'secret access token'}).includes('secret'));
  h=harness({loadError:true});await h.controller.start();assert.equal(h.controller.snapshot().status,'error');h.recover();await h.controller.start();assert.equal(h.controller.snapshot().status,'ready');
}
async function sdkContract() {
  const calls=[], auth={currentUser:member,authStateReady:async()=>calls.push('ready')}, app={name:'synap-account'};
  class Provider {constructor(id='google.com'){this.id=id;this.scopes=[];}setCustomParameters(params){this.params=params;}addScope(scope){this.scopes.push(scope);}}
  const adapter=await loadFirebaseAdapter(config.firebase,async()=>[
    {getApps:()=>[],initializeApp:(settings,name)=>{assert.equal(settings,config.firebase);assert.equal(name,app.name);return app;}},
    {getAuth:a=>{assert.equal(a,app);return auth;},useDeviceLanguage:a=>assert.equal(a,auth),GoogleAuthProvider:Provider,OAuthProvider:Provider,
      onAuthStateChanged:(a,listener)=>{assert.equal(a,auth);listener(a.currentUser);return ()=>{};},signInWithPopup:(a,p)=>{assert.equal(a,auth);calls.push(p);return Promise.resolve();},signOut:a=>{assert.equal(a,auth);a.currentUser=null;}}
  ]);
  let restored;adapter.subscribe(u=>restored=u);assert.equal(restored,member);
  await adapter.signIn('google');assert.equal(calls[1].id,'google.com');assert.deepEqual(calls[1].params,{prompt:'select_account'});
  await adapter.signIn('apple');assert.equal(calls[2].id,'apple.com');assert.deepEqual(calls[2].scopes,['email','name']);
  await adapter.signOut();assert.equal(adapter.currentUser(),null);
}
function activityGuard() {
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const guard=source.slice(source.indexOf('  function blockAccountSignIn('),source.indexOf('  function bindEvents('));
  const context={firmwareBusy:false,recordingConfirmed:false,finalizing:false,unsavedAudio:false,appState:'disconnected'};
  vm.runInNewContext(guard,context);
  const denied=()=>{let blocked=false;context.blockAccountSignIn({preventDefault:()=>blocked=true});return blocked;};
  assert.equal(denied(),false);
  for(const key of ['firmwareBusy','recordingConfirmed','finalizing','unsavedAudio']) {context[key]=true;assert.equal(denied(),true,key);context[key]=false;}
  for(const state of ['connecting','starting','recording','stopping','saving','updating']) {context.appState=state;assert.equal(denied(),true,state);}
  context.appState='connected';assert.equal(denied(),false);
}
async function viewIntegration() {
  const elements=new Map(),listeners={}, views=[];
  function element(id) {if(!elements.has(id)) elements.set(id,{hidden:false,style:{},attrs:{},textContent:'',open:false,disabled:false,classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},addEventListener(t,f){this[t]=f;},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);}
  let adapterCallback, current=null;
  const context={window:{SYNAP_AUTH_CONFIG:config,SynapAuth:{createController,loadFirebaseAdapter:async()=>({currentUser:()=>current,subscribe:f=>{adapterCallback=f;return()=>{};},signIn:async()=>{current={...member,displayName:'<img src=x onerror=alert(1)>'};adapterCallback(current);},signOut:async()=>{current=null;adapterCallback(null);}})},addEventListener:(t,f)=>listeners[t]=f},
    document:{getElementById:element,dispatchEvent:()=>true},navigator:{onLine:true},CustomEvent:class {},setTimeout,clearTimeout};
  vm.runInNewContext(fs.readFileSync(path.join(root,'account.js'),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(element('accountDialog').open,false,'account does not interrupt startup');
  element('accountButton').click();assert.equal(element('accountDialog').open,true);
  element('accountLater').click();assert.equal(element('accountDialog').open,false,'guest dismissal stays available');
  assert.equal(element('googleSignIn').disabled,false);
  await element('googleSignIn').click();
  assert.equal(element('accountName').textContent,current.displayName,'profile is rendered as text');
  assert.equal(element('accountIcon').style.display,'none');assert.equal(element('accountProviders').hidden,true);
  await element('accountSignOut').click();assert.equal(element('accountProviders').hidden,false);assert.equal(element('accountIdentity').hidden,true);
}
(async()=>{await controllers();await sdkContract();activityGuard();await viewIntegration();console.log('PASS: Google/Apple login, session restore/sign-out, guest flow, errors, provider configuration, SDK adapter and recording/OTA guards');})().catch(error=>{console.error(error);process.exitCode=1;});
