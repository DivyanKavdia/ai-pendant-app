const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'ai-providers.js'), 'utf8');
const saved = new Map();
const context = {
  console,
  Date,
  JSON,
  Error,
  Set,
  Map,
  localStorage: {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value)
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

const ai = context.SynapAI;
assert(ai, 'SynapAI export');
assert.equal(ai.readPrefs().provider, 'openai');
assert.equal(ai.readPrefs().sttModel, 'gpt-4o-mini-transcribe');
assert.equal(ai.readPrefs().llmModel, 'gpt-5-mini');
assert.equal(ai.OPENAI_TRANSCRIBE, 'https://api.openai.com/v1/audio/transcriptions');
assert.equal(ai.OPENAI_RESPONSES, 'https://api.openai.com/v1/responses');
assert.equal(ai.SEGMENTS_PER_BLOCK, 10, 'ten 30-second chunks form a five-minute block');

ai.savePrefs({provider:'custom',sttModel:'x',llmModel:'y',language:'hi'});
assert.deepEqual(JSON.parse(JSON.stringify(ai.readPrefs())), {provider:'custom',sttModel:'x',llmModel:'y',language:'hi'});
assert(!saved.get('synap-ai-provider-settings').includes('sk-'), 'API key must never be persisted');

assert.equal(ai.outputText({output_text:'hello'}), 'hello');
assert.equal(ai.outputText({output:[{content:[{type:'output_text',text:'world'}]}]}), 'world');

const segments = Array.from({length: 21}, (_, index) => ({index, transcript:'segment ' + index}));
const groups = ai.groupSegments(segments);
assert.equal(groups.length, 3);
assert.equal(groups[0].length, 10);
assert.equal(groups[1].length, 10);
assert.equal(groups[2].length, 1);
assert.match(ai.blockInput(groups[0]), /\[00:00–00:30\]/);
assert.match(ai.blockInput(groups[0]), /\[04:30–05:00\]/);
assert.equal(ai.BLOCK_SCHEMA.additionalProperties, false);

const formatted = ai.meetingText({
  executive_summary:'Summary',
  key_points:['Point'], decisions:['Decision'],
  action_items:[{task:'Send note',owner:'Alex',due_date:'Friday'}],
  questions:['Question'], follow_ups:['Follow up']
});
assert.match(formatted, /Summary/);
assert.match(formatted, /Decisions/);
assert.match(formatted, /Send note — Alex · Friday/);
assert.equal(ai.MEETING_SCHEMA.additionalProperties, false);
assert(ai.MEETING_SCHEMA.required.includes('action_items'));
assert.match(source, /processingStrategy: '30s-stt-5m-blocks-final'/);
assert.match(source, /meetingBlocks/);
assert.match(source, /later block explicitly changes an earlier proposal or decision/);

console.log('PASS: OpenAI preset, non-persistent keys, 30s STT grouping, 5-minute block synthesis and structured meeting formatting.');
