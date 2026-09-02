const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.open=false;this.hidden=false;this.textContent='';}
  append(...nodes){this.children.push(...nodes);} appendChild(node){this.append(node);return node;}
  setAttribute(key,value){this.attrs[key]=value;} addEventListener(type,handler){this.events[type]=handler;}
  querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
  pause(){this.paused=true;}
}
const fixture=i=>({id:String(i),name:'Moment '+i,createdAt:'2026-09-02T09:00:00Z',durationMs:60000,sizeBytes:100,journal:true,notes:'My note',transcript:'Transcript text',summary:'Summary text'});
const ui={recordingsList:new Element('div'),libraryPagination:new Element('div'),libraryCountLabel:new Element('p'),showMoreRecordingsButton:new Element('button'),showLessRecordingsButton:new Element('button')};
const c={ui,document:{createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)},libraryVisibleCount:5,libraryRecordings:[],LIBRARY_PAGE_SIZE:5,
  formatDuration:()=> '01:00',formatDate:()=> '2 Sep',formatBytes:()=> '100 B',DEFAULT_SAMPLE_RATE:16000,renderedObjectUrls:[],bindDebouncedSave(){}};
vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('  function renderLibraryPage()'),source.indexOf('  function bindDebouncedSave(')),c);
for(const length of [0,3,5,8]){
  ui.recordingsList.children=[];c.libraryRecordings=Array.from({length},(_,i)=>fixture(i));c.libraryVisibleCount=5;c.renderLibraryPage();
  assert.equal(ui.recordingsList.children.length,Math.min(5,length));assert.equal(ui.libraryPagination.hidden,length<=5);
  assert.equal(ui.libraryCountLabel.textContent,Math.min(5,length)+' of '+length);
}
c.libraryVisibleCount=10;c.renderLibraryPage();assert.equal(ui.recordingsList.children.length,8);assert.equal(ui.showMoreRecordingsButton.hidden,true);assert.equal(ui.showLessRecordingsButton.hidden,false);
const last=ui.recordingsList.children[7];assert.equal(last.children.length,1,'content stays lazy');last.open=true;last.events.toggle();
assert.equal(last.children.length,2);const content=last.children[1];
assert.equal(content.children[0].tag,'audio');assert.equal(content.children[1].className,'recording-actions');
const disclosures=content.children.filter(node=>node.tag==='details');assert.equal(disclosures.length,4);
assert.deepEqual(disclosures.map(node=>node.children[0].textContent),['Notes','Transcript','Summary','Edit name & details']);
assert(disclosures.every(node=>!node.open),'extra text is initially collapsed');
assert.equal(content.querySelectorAll('textarea')[0].value,'My note');assert.equal(content.querySelectorAll('textarea')[1].value,'Transcript text');
assert.equal(content.querySelectorAll('input')[0].attrs['aria-label'],'Recording name');
assert.equal(content.children[1].children[2].textContent,'Process queue');
last.open=false;last.events.toggle();assert.equal(content.children[0].paused,true);
last.open=true;last.events.toggle();assert.equal(last.children.length,2,'reopening does not duplicate audio');
c.libraryVisibleCount=5;c.renderLibraryPage();assert.equal(last.hidden,true);assert.equal(last.open,false);
assert.equal(last.children[0].children[0].children[0].attrs['aria-hidden'],'true');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert(!html.includes('YOUR LIBRARY'));assert(!html.includes('Saved moments'));
assert(html.includes('aria-labelledby="libraryTitle"'));
console.log('PASS: compact Library pagination, lazy content, disclosures, preserved edits and pause on collapse');
