'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');

class MockCharacteristic extends EventTarget {
  constructor(uuid){super();this.uuid=uuid;this.value=null}
  emit(value){this.value=value;this.dispatchEvent(new Event('characteristicvaluechanged'))}
}
const codec=require(path.join(__dirname,'../audio-codec-v3.js'));

function rmsError(left,right){let total=0;for(let i=0;i<left.length;i++){const difference=left[i]-right[i];total+=difference*difference}return Math.sqrt(total/left.length)}

test('IMA ADPCM frame stays independent and intelligible',()=>{
  const pcm=new Int16Array(codec.SAMPLES_PER_FRAME);
  for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(Math.sin(i*0.071)*12000+Math.sin(i*0.013)*1800);
  const encoded=codec.encodeFrame(pcm);
  assert.equal(encoded.byteLength,404);
  assert.equal(encoded[3],codec.CODEC_IMA_ADPCM);
  const decoded=new Int16Array(codec.decodeFrame(encoded).buffer);
  assert.equal(decoded.length,pcm.length);
  assert.ok(rmsError(pcm,decoded)<500);
});

test('protocol-v3 BLE chunks are converted into four legacy PCM chunks through EventTarget',()=>{
  const pcm=new Int16Array(codec.SAMPLES_PER_FRAME);
  for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(Math.sin(i*0.05)*9000);
  const encoded=codec.encodeFrame(pcm),characteristic=new MockCharacteristic(codec.AUDIO_UUID),received=[];
  characteristic.addEventListener('characteristicvaluechanged',event=>received.push(event.target.value));
  const sequence=321,total=4,payload=101;
  for(let chunk=0;chunk<total;chunk++){
    const packet=new Uint8Array(8+payload),view=new DataView(packet.buffer);
    packet[0]=codec.MAGIC;packet[1]=codec.COMPRESSED_VERSION;view.setUint16(2,sequence,true);
    packet[4]=chunk;packet[5]=total;view.setUint16(6,payload,true);
    packet.set(encoded.subarray(chunk*payload,(chunk+1)*payload),8);
    characteristic.emit(view);
  }
  assert.equal(received.length,4);
  const restored=new Uint8Array(1600);
  received.forEach((value,index)=>{
    assert.equal(value.getUint8(0),codec.MAGIC);
    assert.equal(value.getUint8(1),2);
    assert.equal(value.getUint16(2,true),sequence);
    assert.equal(value.getUint8(4),index);
    assert.equal(value.getUint8(5),4);
    assert.equal(value.getUint16(6,true),400);
    restored.set(new Uint8Array(value.buffer,value.byteOffset+8,400),index*400);
  });
  assert.deepEqual(restored,codec.decodeFrame(encoded));
});

test('production HTML loads the protocol-v3 decoder before app.js',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const codecPosition=html.indexOf('audio-codec-v3.js');
  const appPosition=html.indexOf('app.js');
  assert.ok(codecPosition>=0,'audio-codec-v3.js must be loaded by index.html');
  assert.ok(appPosition>=0,'app.js must be loaded by index.html');
  assert.ok(codecPosition<appPosition,'decoder must install before app.js registers the audio listener');
});
