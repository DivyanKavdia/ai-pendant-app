import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateDek,
  isSealed,
  openBytes,
  openJson,
  openText,
  sealBytes,
  sealJson,
  sealText,
  wipe,
  type Binding,
} from '../src/crypto/envelope.js';

const binding: Binding = { uid: 'user-a', scope: 'recording/r1/segment/0', field: 'transcript' };

test('sealed text round-trips under the same key and binding', () => {
  const dek = generateDek();
  const sealed = sealText(dek, 'Ankit said the launch moves to Friday', binding);
  assert.equal(openText(dek, sealed, binding), 'Ankit said the launch moves to Friday');
});

test('ciphertext never contains the plaintext', () => {
  const dek = generateDek();
  const sealed = sealText(dek, 'the launch moves to Friday', binding);
  const blob = JSON.stringify(sealed);
  assert.ok(!blob.includes('launch'));
  assert.ok(!blob.includes('Friday'));
});

test('a fresh IV is drawn per seal, so identical plaintexts differ', () => {
  const dek = generateDek();
  const a = sealText(dek, 'same input', binding);
  const b = sealText(dek, 'same input', binding);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('a different user key cannot open the envelope', () => {
  const mine = generateDek();
  const theirs = generateDek();
  const sealed = sealText(mine, 'private', binding);
  assert.throws(() => openText(theirs, sealed, binding));
});

test('moving a ciphertext to another user fails authentication', () => {
  const dek = generateDek();
  const sealed = sealText(dek, 'private', binding);
  assert.throws(() => openText(dek, sealed, { ...binding, uid: 'user-b' }));
});

test('moving a ciphertext to another field fails authentication', () => {
  const dek = generateDek();
  const sealed = sealText(dek, 'private', binding);
  assert.throws(() => openText(dek, sealed, { ...binding, field: 'summary' }));
});

test('tampering with the ciphertext is detected', () => {
  const dek = generateDek();
  const sealed = sealText(dek, 'the launch moves to Friday', binding);
  const bytes = Buffer.from(sealed.ct, 'base64');
  bytes[0] = bytes[0]! ^ 0xff;
  assert.throws(() => openText(dek, { ...sealed, ct: bytes.toString('base64') }, binding));
});

test('tampering with the auth tag is detected', () => {
  const dek = generateDek();
  const sealed = sealText(dek, 'private', binding);
  const tag = Buffer.from(sealed.tag, 'base64');
  tag[0] = tag[0]! ^ 0x01;
  assert.throws(() => openText(dek, { ...sealed, tag: tag.toString('base64') }, binding));
});

test('binary payloads round-trip byte for byte', () => {
  const dek = generateDek();
  const audio = Buffer.alloc(4096);
  for (let index = 0; index < audio.length; index += 1) audio[index] = index % 251;
  const sealed = sealBytes(dek, audio, { ...binding, field: 'audio' });
  assert.deepEqual(openBytes(dek, sealed, { ...binding, field: 'audio' }), audio);
});

test('JSON payloads round-trip', () => {
  const dek = generateDek();
  const value = { people: [{ name: 'Ankit', confidence: 0.91 }], topics: ['launch'] };
  const sealed = sealJson(dek, value, binding);
  assert.deepEqual(openJson(dek, sealed, binding), value);
});

test('an unsupported envelope version is rejected rather than guessed at', () => {
  const dek = generateDek();
  const sealed = sealText(dek, 'private', binding);
  assert.throws(() => openText(dek, { ...sealed, v: 99 }, binding), /Unsupported envelope version/);
});

test('a short key is rejected before it can be used', () => {
  assert.throws(() => sealText(Buffer.alloc(16), 'private', binding), /must be 32 bytes/);
});

test('isSealed recognises real envelopes and rejects loose objects', () => {
  const dek = generateDek();
  assert.ok(isSealed(sealText(dek, 'x', binding)));
  assert.ok(!isSealed({ iv: 'a', ct: 'b' }));
  assert.ok(!isSealed(null));
  assert.ok(!isSealed('string'));
});

test('wipe zeroes key material', () => {
  const dek = generateDek();
  wipe(dek);
  assert.ok(dek.every((byte) => byte === 0));
});

test('binding parts are required', () => {
  const dek = generateDek();
  assert.throws(() => sealText(dek, 'x', { uid: '', scope: 's', field: 'f' }));
});
