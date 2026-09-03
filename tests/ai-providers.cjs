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

ai.savePrefs({provider:'custom',sttModel:'x',llmModel:'y',language:'hi'});
assert.deepEqual(JSON.parse(JSON.stringify(ai.readPrefs())), {provider:'custom',sttModel:'x',llmModel:'y',language:'hi'});
assert(!saved.get('synap-ai-provider-settings').includes('sk-'), 'API key must never be persisted');

assert.equal(ai.outputText({output_text:'hello'}), 'hello');
assert.equal(ai.outputText({output:[{content:[{type:'output_text',text:'world'}]}]}), 'world');

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

console.log('PASS: OpenAI preset, non-persistent keys, Responses parsing and structured meeting formatting.');
