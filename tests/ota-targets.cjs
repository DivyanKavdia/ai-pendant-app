const {test}=require('node:test'),assert=require('node:assert/strict');
const ota=require('../ota.js');

function image(target,size=512){
  const config=ota.IMAGE_TARGETS[target],bytes=new Uint8Array(size);bytes[0]=0xE9;
  new DataView(bytes.buffer).setUint16(12,config.chip,true);
  new DataView(bytes.buffer).setUint32(32,0xABCD5432,true);
  bytes.set(new TextEncoder().encode(config.marker),64);
  return bytes;
}

test('OTA image validator accepts both known hardware targets and rejects cross-target images',()=>{
  const s3='esp32s3-fh4r2-qspi-4m',c3='esp32c3-supermini-4m';
  assert.equal(ota.validateImage(image(s3),2048,3,s3),s3);
  assert.equal(ota.validateImage(image(c3),2048,3,c3),c3);
  assert.equal(ota.validateImage(image(c3),2048,3),c3,'client can infer the target after release verification');
  assert.throws(()=>ota.validateImage(image(s3),2048,3,c3),/selected synap hardware target/);
  const wrong=image(c3);new DataView(wrong.buffer).setUint16(12,9,true);
  assert.throws(()=>ota.validateImage(wrong,2048,3,c3),/selected synap hardware target/);
});
