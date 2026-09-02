/* DK Pendant 5.0 — dependency-free chunk journal and durable FIFO processor.
 * No provider credentials or third-party code. Wire format remains BLE v2.
 */
(function (root) {
  'use strict';
  const SEGMENT_FRAMES = 600; // 30 seconds; never send 80–160 byte BLE packets to STT.
  const MAX_BUFFER_PACKETS = 1600; // ~4 seconds at minimum supported MTU.
  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function wav(frames) {
    const bytes = frames.reduce((n, f) => n + f.byteLength, 0);
    const header = new ArrayBuffer(44), view = new DataView(header);
    const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF');view.setUint32(4, bytes + 36, true);text(8, 'WAVE');text(12, 'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);
    view.setUint16(34,16,true);text(36,'data');view.setUint32(40,bytes,true);
    return new Blob([header,...frames], {type:'audio/wav'});
  }
  function assemble(packets) {
    const groups = new Map(), frames = [];
    for (const packet of packets) {
      if (!groups.has(packet.sequence)) groups.set(packet.sequence, []);
      groups.get(packet.sequence).push(packet);
    }
    let incomplete = 0;
    for (const sequence of [...groups.keys()].sort((a,b)=>a-b)) {
      const parts = groups.get(sequence).sort((a,b)=>a.chunk-b.chunk);
      const total = parts[0].total;
      if (parts.length !== total || parts.some((p,i)=>p.chunk!==i || p.total!==total) ||
          parts.reduce((n,p)=>n+p.payload.byteLength,0)!==1600) { incomplete++;continue; }
      const frame = new Uint8Array(1600);let offset=0;
      for (const p of parts) {frame.set(p.payload,offset);offset+=p.payload.byteLength;}
      frames.push(frame);
    }
    return {frames,incomplete,packets:packets.length,frameGroups:groups.size,
      lastSequence:groups.size?Math.max(...groups.keys()):-1};
  }

  class AudioStore {
    constructor(options={}) {
      this.idb = options.indexedDB || root.indexedDB;
      this.keys = options.IDBKeyRange || root.IDBKeyRange;
      this.name = options.name || 'dk-pendant-recordings';
      this.onError = options.onError || (()=>{});
      this.buffer = [];this.timer=null;this.writing=Promise.resolve();
      this.failed=null;this.dbPromise=null;this.bufferedCount=0;
    }
    async open() {
      if (this.dbPromise) return this.dbPromise;
      this.dbPromise = new Promise((resolve,reject)=>{
        const req=this.idb.open(this.name,2);
        req.onupgradeneeded=()=>{
          const db=req.result;
          if (!db.objectStoreNames.contains('recordings')) {
            db.createObjectStore('recordings',{keyPath:'id'}).createIndex('createdAt','createdAt');
          }
          if (!db.objectStoreNames.contains('packets')) {
            const packets=db.createObjectStore('packets',{keyPath:['recordingId','sequence','chunk']});
            packets.createIndex('recording','recordingId');
            packets.createIndex('segment',['recordingId','segmentIndex']);
          }
          if (!db.objectStoreNames.contains('segments')) {
            db.createObjectStore('segments',{keyPath:['recordingId','index']}).createIndex('recording','recordingId');
          }
          if (!db.objectStoreNames.contains('jobs')) {
            const jobs=db.createObjectStore('jobs',{keyPath:'id',autoIncrement:true});
            jobs.createIndex('recording','recordingId');jobs.createIndex('dedupe','dedupe',{unique:true});
          }
        };
        req.onblocked=()=>reject(new Error('Storage upgrade blocked. Close other pendant tabs, then reload. Do not clear site data.'));
        req.onerror=()=>reject(req.error);
        req.onsuccess=()=>{
          req.result.onversionchange=()=>req.result.close();
          resolve(req.result);
        };
      });
      return this.dbPromise;
    }
    async atomic(names, action) {
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        let tx;
        // Strict durability is requested; browsers may still evict site storage.
        try {tx=db.transaction(names,'readwrite',{durability:'strict'});}
        catch (e) {if(e.name!=='TypeError') {reject(e);return;}tx=db.transaction(names,'readwrite');}
        let result, failure;
        tx.oncomplete=()=>resolve(result);
        tx.onerror=tx.onabort=()=>reject(failure || tx.error || new Error('Storage transaction aborted'));
        try {action(Object.fromEntries(names.map(n=>[n,tx.objectStore(n)])),v=>{result=v;},tx);}
        catch(e){failure=e;tx.abort();}
      });
    }
    async get(store,key) {
      const db=await this.open();return requestValue(db.transaction(store).objectStore(store).get(key));
    }
    async all(store,index,key) {
      const db=await this.open();let source=db.transaction(store).objectStore(store);
      if(index)source=source.index(index);
      return requestValue(source.getAll(key));
    }
    async begin(name, association = null) {
      if(this.failed) throw this.failed;
      const id=root.crypto.randomUUID();
      await this.atomic(['recordings'],s=>s.recordings.add({id,name,createdAt:new Date().toISOString(),
        journal:true,status:'recording',sampleRate:16000,
        deviceId:association?.deviceId || null, deviceAssociationId:association?.associationId || null,
        pwaInstallationId:association?.installationId || null, notes:'',transcript:'',summary:'',durationMs:0,sizeBytes:0}));
      return id;
    }
    append(recordingId,packet) {
      if(this.failed)throw this.failed;
      if(this.bufferedCount>=MAX_BUFFER_PACKETS)throw new Error('Storage cannot keep up with BLE; stopping to preserve buffered chunks.');
      this.buffer.push({recordingId,sequence:packet.sequence,chunk:packet.chunk,total:packet.total,
        segmentIndex:Math.floor(packet.sequence/SEGMENT_FRAMES),payload:packet.payload.slice()});
      this.bufferedCount++;
      if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;this.flush().catch(this.onError);},100);
    }
    async flush() {
      clearTimeout(this.timer);this.timer=null;
      if(this.failed)throw this.failed;
      const batch=this.buffer.splice(0);
      this.writing=this.writing.then(async()=>{
        if(!batch.length)return;
        try {
          await this.atomic(['packets','segments'],s=>{
            const segments=new Map();
            for(const p of batch){s.packets.put(p);segments.set(p.recordingId+':'+p.segmentIndex,p);}
            for(const p of segments.values()){
              const req=s.segments.get([p.recordingId,p.segmentIndex]);
              req.onsuccess=()=>{if(!req.result)s.segments.put({recordingId:p.recordingId,index:p.segmentIndex,closed:false});};
            }
          });
          this.bufferedCount-=batch.length;
        } catch(e){this.buffer.unshift(...batch);this.failed=e;throw e;}
      },e=>{this.buffer.unshift(...batch);throw e;});
      return this.writing;
    }
    async retryFlush() {this.failed=null;this.writing=Promise.resolve();return this.flush();}
    async segment(recordingId,index) {
      const meta=await this.get('segments',[recordingId,index]);
      if(meta?.legacy)return {blob:(await this.get('recordings',recordingId))?.blob,frames:[],incomplete:0,packets:0};
      return assemble(await this.all('packets','segment',[recordingId,index]));
    }
    async enqueueLegacy(recordingId) {
      return this.atomic(['recordings','segments','jobs'],s=>{
        const req=s.recordings.get(recordingId);
        req.onsuccess=()=>{
          const r=req.result;if(!r || r.journal || r.queuedLegacy || !r.blob)return;
          // Old WAVs have no original packet journal. Retain the original, queue as one segment.
          s.recordings.put({...r,queuedLegacy:true});
          s.segments.put({recordingId,index:0,closed:true,legacy:true,frameCount:Math.max(1,Math.ceil((r.durationMs||50)/50))});
          for(const kind of ['transcribe','summarize','consolidate'])s.jobs.add({recordingId,
            segmentIndex:kind==='consolidate'?-1:0,kind,dedupe:recordingId+':legacy:'+kind,
            state:'pending',attempts:0,nextAt:0});
        };
      });
    }
    async close(recordingId,reason='normal') {
      await this.flush();
      const record=await this.get('recordings',recordingId);
      if(!record || !record.journal)return;
      const segments=(await this.all('segments','recording',recordingId)).sort((a,b)=>a.index-b.index);
      let count=0,incomplete=0,packets=0,frameGroups=0,lastSequence=-1;
      for(const segment of segments){
        const data=await this.segment(recordingId,segment.index);
        count+=data.frames.length;incomplete+=data.incomplete;packets+=data.packets;
        frameGroups+=data.frameGroups;lastSequence=Math.max(lastSequence,data.lastSequence);
        await this.atomic(['segments','jobs'],s=>{
          const req=s.segments.get([recordingId,segment.index]);
          req.onsuccess=()=>{
            if(!req.result || req.result.closed)return;
            s.segments.put({...req.result,closed:true,frameCount:data.frames.length,incomplete:data.incomplete});
            if(data.frames.length)for(const kind of ['transcribe','summarize']) {
              s.jobs.add({recordingId,segmentIndex:segment.index,kind,
                dedupe:recordingId+':'+segment.index+':'+kind,state:'pending',attempts:0,nextAt:0});
            }
          };
        });
      }
      await this.atomic(['recordings','jobs'],s=>{
        const req=s.recordings.get(recordingId);
        req.onsuccess=()=>{
          if(!req.result)return;
          const previous=req.result;
          s.recordings.put({...previous,status:count?'saved':'empty',stopReason:reason,
            durationMs:count*50,sizeBytes:count?44+count*1600:0,
            stats:{completeFrames:count,incompleteFrames:incomplete,packetsReceived:packets,
              missingFrames:Math.max(0,lastSequence+1-frameGroups)},sealed:true});
          if(!previous.sealed && count)s.jobs.add({recordingId,kind:'consolidate',segmentIndex:-1,
            dedupe:recordingId+':consolidate',state:'pending',attempts:0,nextAt:0});
        };
      });
      return this.get('recordings',recordingId);
    }
    async recover() {
      const records=(await this.all('recordings')).filter(r=>r.journal&&!r.sealed)
        .sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      for(const r of records)await this.close(r.id,'recovered-after-interruption');
      return records.length;
    }
    async blob(record) {
      if(record.blob)return record.blob; // Preserve v4 and older saved WAVs.
      const segments=new Set((await this.all('segments','recording',record.id)).map(s=>s.index));
      for(const p of this.buffer)if(p.recordingId===record.id)segments.add(p.segmentIndex);
      const frames=[];
      for(const index of [...segments].sort((a,b)=>a-b)){
        const packets=await this.all('packets','segment',[record.id,index]);
        const unique=new Map(packets.map(p=>[p.sequence+':'+p.chunk,p]));
        for(const p of this.buffer)if(p.recordingId===record.id&&p.segmentIndex===index)unique.set(p.sequence+':'+p.chunk,p);
        frames.push(...assemble([...unique.values()]).frames);
      }
      if(!frames.length)throw new Error('No complete audio frames are available. Raw partial chunks remain stored.');
      return wav(frames); // Assemble only on explicit playback/export, not every list refresh.
    }
    async remove(id) {
      await this.atomic(['recordings','packets','segments','jobs'],s=>{
        s.recordings.delete(id);
        for(const name of ['packets','segments','jobs']){
          const cursor=s[name].index('recording').openCursor(this.keys.only(id));
          cursor.onsuccess=()=>{if(cursor.result){cursor.result.delete();cursor.result.continue();}};
        }
      });
    }
    async clear() {await this.atomic(['recordings','packets','segments','jobs'],s=>Object.values(s).forEach(store=>store.clear()));}
    async head() {
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        const req=db.transaction('jobs').objectStore('jobs').openCursor();
        req.onerror=()=>reject(req.error);
        req.onsuccess=()=>{
          const c=req.result;if(!c){resolve(null);return;}
          if(c.value.state==='done'){c.continue();return;}resolve(c.value);
        };
      });
    }
    async patchJob(id,fields) {
      return this.atomic(['jobs'],(s,result)=>{
        const req=s.jobs.get(id);req.onsuccess=()=>{
          if(!req.result){result(false);return;}s.jobs.put({...req.result,...fields});result(true);
        };
      });
    }
    async finishJob(job,output) {
      // Output and completion commit together. Missing/deleted job never recreates data.
      return this.atomic(['jobs','segments','recordings'],s=>{
        const req=s.jobs.get(job.id);req.onsuccess=()=>{
          if(!req.result)return;
          const store=job.kind==='consolidate'?s.recordings:s.segments;
          const item=store.get(job.kind==='consolidate'?job.recordingId:[job.recordingId,job.segmentIndex]);
          item.onsuccess=()=>{
            if(!item.result)return;
            store.put({...item.result,...output});
            s.jobs.put({...req.result,state:'done',lastError:'',finishedAt:Date.now()});
          };
        };
      });
    }
  }

  class FIFOProcessor {
    constructor(store,{settings,fetch:fetcher=root.fetch?.bind(root),locks=root.navigator?.locks,
      onChange=()=>{},now=()=>Date.now(),canRun=()=>true}={}){
      this.store=store;this.settings=settings;this.fetch=fetcher;this.locks=locks;
      this.onChange=onChange;this.now=now;this.running=false;this.paused=true;this.controller=null;this.timer=null;
      this.canRun=canRun;
    }
    pause(){this.paused=true;clearTimeout(this.timer);this.controller?.abort();this.onChange('Queue paused');}
    async resume(){if(!this.canRun())return;this.paused=false;return this.run();}
    async retry(){const head=await this.store.head();if(head)await this.store.patchJob(head.id,{state:'pending',attempts:0,nextAt:0,lastError:''});return this.resume();}
    async run(){
      if(this.paused || this.running || !this.canRun())return;
      if(!this.locks){this.onChange('FIFO requires Web Locks. Use current Android Chrome.');return;}
      this.running=true;
      try {
        await this.locks.request('dk-pendant-processing',{ifAvailable:true},async lock=>{
          if(!lock){this.onChange('Another tab is processing the queue');return;}
          while(!this.paused && this.canRun()){
            const job=await this.store.head();
            if(this.paused || !this.canRun())return;
            if(!job){this.onChange('Queue complete');return;}
            if(job.state==='failed'){this.onChange('Queue blocked at job '+job.id+': '+job.lastError);return;}
            const delay=job.nextAt-this.now();
            if(delay>0){this.onChange('Retry waiting for job '+job.id);this.timer=setTimeout(()=>this.run(),delay+10);return;}
            const config=this.settings();
            const url=job.kind==='transcribe'?config.endpoint:config.llmEndpoint;
            if(!url){this.onChange('Queue waiting: configure '+(job.kind==='transcribe'?'transcription':'LLM')+' endpoint');return;}
            if(new URL(url).protocol!=='https:')throw new Error('Processing endpoints must use HTTPS');
            await this.store.patchJob(job.id,{state:'running',startedAt:this.now()});
            if(this.paused || !this.canRun()){
              await this.store.patchJob(job.id,{state:'pending'});return;
            }
            this.onChange('Job '+job.id+' · '+job.kind+' · segment '+(job.segmentIndex+1));
            try {
              const output=await this.process(job,config,url);
              await this.store.finishJob(job,output);this.onChange('Saved job '+job.id);
            } catch(e){
              const attempts=(job.attempts||0)+(this.paused?0:1);
              const nextAt=this.paused?0:this.now()+Math.min(60000,2000*2**Math.max(0,attempts-1));
              await this.store.patchJob(job.id,{state:attempts>=5?'failed':'pending',attempts,nextAt,
                lastError:e.name+': '+e.message});
              this.onChange('Job '+job.id+' paused/retry: '+e.message);
              if(!this.paused&&attempts<5)this.timer=setTimeout(()=>this.run(),nextAt-this.now()+10);
              return; // Never jump past a failed head: strict FIFO.
            }
          }
        });
      } catch(e){this.onChange('Queue error: '+e.message);}
      finally {this.running=false;}
    }
    async process(job,config,url){
      const headers={'Idempotency-Key':job.dedupe};
      if(config.token)headers.Authorization='Bearer '+config.token;
      let body;
      if(job.kind==='transcribe'){
        const data=await this.store.segment(job.recordingId,job.segmentIndex);
        if(!data.blob&&!data.frames.length)throw new Error('Segment has no complete PCM frames');
        body=new FormData();body.append('audio',data.blob||wav(data.frames),'segment-'+job.segmentIndex+'.wav');
        body.append('recording_id',job.recordingId);body.append('segment_index',String(job.segmentIndex));
        body.append('sample_rate','16000');
      } else {
        headers['Content-Type']='application/json';
        let input;
        if(job.kind==='summarize'){
          const segment=await this.store.get('segments',[job.recordingId,job.segmentIndex]);
          if(!segment || typeof segment.transcript!=='string')throw new Error('Missing prior transcription');
          input=segment.transcript;
        } else {
          const segments=(await this.store.all('segments','recording',job.recordingId)).filter(s=>s.frameCount)
            .sort((a,b)=>a.index-b.index);
          if(segments.some(s=>typeof s.summary!=='string'))throw new Error('Missing prior segment summary');
          input=segments.map(s=>({index:s.index,summary:s.summary}));
        }
        body=JSON.stringify({task:job.kind==='summarize'?'summarize_segment':'consolidate',
          recording_id:job.recordingId,segment_index:job.segmentIndex,input});
      }
      // OTA may take ownership while segment/transcript storage reads are pending.
      if(this.paused || !this.canRun()){
        const error=new Error('Processing paused before upload');error.name='AbortError';throw error;
      }
      this.controller=new AbortController();
      const timeout=setTimeout(()=>this.controller?.abort(),120000);
      try {
        const response=await this.fetch(url,{method:'POST',headers,body,signal:this.controller.signal});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const json=(response.headers.get('content-type')||'').includes('application/json');
        const data=json?await response.json():await response.text();
        if(job.kind==='transcribe'){
          const transcript=json?(data.transcript??data.text):data;
          if(typeof transcript!=='string')throw new Error('Response needs text or transcript');
          return {transcript}; // Empty is valid for a silent segment.
        }
        const summary=json?data.summary:data;
        if(typeof summary!=='string')throw new Error('Response needs summary');
        if(job.kind==='consolidate'){
          const segments=(await this.store.all('segments','recording',job.recordingId)).sort((a,b)=>a.index-b.index);
          return {summary,transcript:segments.map(s=>s.transcript||'').join('\n'),processingState:'done'};
        }
        return {summary};
      } finally {clearTimeout(timeout);this.controller=null;}
    }
  }
  root.DKAudioStore=AudioStore;root.DKFIFOProcessor=FIFOProcessor;
  root.DKAudioCodec={assemble,wav,SEGMENT_FRAMES};
})(globalThis);

