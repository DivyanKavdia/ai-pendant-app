/* Synap AI provider presets for buffered transcription and hierarchical meeting intelligence.
 * API keys are never persisted by this module. Provider/model/language choices may persist locally.
 */
(function (root) {
  'use strict';

  const PREF_KEY = 'synap-ai-provider-settings';
  const OPENAI_TRANSCRIBE = 'https://api.openai.com/v1/audio/transcriptions';
  const OPENAI_RESPONSES = 'https://api.openai.com/v1/responses';
  const SEGMENTS_PER_BLOCK = 10; // 10 x 30 seconds = ~5 minutes.
  const DEFAULTS = {
    provider: 'openai',
    sttModel: 'gpt-4o-mini-transcribe',
    llmModel: 'gpt-5-mini',
    language: 'auto'
  };

  const ACTION_ITEM_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      task: { type: 'string' },
      owner: { type: 'string' },
      due_date: { type: 'string' }
    },
    required: ['task', 'owner', 'due_date']
  };

  const BLOCK_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      key_points: { type: 'array', items: { type: 'string' } },
      decisions: { type: 'array', items: { type: 'string' } },
      action_items: { type: 'array', items: ACTION_ITEM_SCHEMA },
      questions: { type: 'array', items: { type: 'string' } },
      follow_ups: { type: 'array', items: { type: 'string' } },
      topics: { type: 'array', items: { type: 'string' } }
    },
    required: ['summary', 'key_points', 'decisions', 'action_items', 'questions', 'follow_ups', 'topics']
  };

  const MEETING_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      executive_summary: { type: 'string' },
      key_points: { type: 'array', items: { type: 'string' } },
      decisions: { type: 'array', items: { type: 'string' } },
      action_items: { type: 'array', items: ACTION_ITEM_SCHEMA },
      questions: { type: 'array', items: { type: 'string' } },
      follow_ups: { type: 'array', items: { type: 'string' } },
      topics: { type: 'array', items: { type: 'string' } }
    },
    required: ['title', 'executive_summary', 'key_points', 'decisions', 'action_items', 'questions', 'follow_ups', 'topics']
  };

  function readPrefs(storage = root.localStorage) {
    try {
      const value = JSON.parse(storage?.getItem(PREF_KEY) || '{}');
      return { ...DEFAULTS, ...value };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  function savePrefs(value, storage = root.localStorage) {
    const safe = {
      provider: value.provider === 'custom' ? 'custom' : 'openai',
      sttModel: String(value.sttModel || DEFAULTS.sttModel),
      llmModel: String(value.llmModel || DEFAULTS.llmModel),
      language: String(value.language || 'auto')
    };
    storage?.setItem(PREF_KEY, JSON.stringify(safe));
    return safe;
  }

  function outputText(data) {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
    const parts = [];
    for (const item of data?.output || []) {
      for (const content of item?.content || []) {
        if ((content.type === 'output_text' || content.type === 'text') && typeof content.text === 'string') parts.push(content.text);
      }
    }
    return parts.join('\n').trim();
  }

  function errorMessage(status, data) {
    const detail = data?.error?.message || data?.message || (typeof data === 'string' ? data.slice(0, 300) : '');
    const error = new Error('OpenAI HTTP ' + status + (detail ? ': ' + detail : ''));
    error.retryable = [408, 409, 425, 429].includes(status) || status >= 500;
    return error;
  }

  async function parseResponse(response) {
    const contentType = response.headers?.get?.('content-type') || '';
    let data;
    try { data = contentType.includes('application/json') ? await response.json() : await response.text(); }
    catch (_) { data = ''; }
    if (!response.ok) throw errorMessage(response.status, data);
    return data;
  }

  function meetingText(meeting) {
    const lines = [meeting.executive_summary || ''];
    const section = (title, values) => {
      if (!values?.length) return;
      lines.push('', title);
      for (const value of values) lines.push('• ' + value);
    };
    section('Key points', meeting.key_points);
    section('Decisions', meeting.decisions);
    if (meeting.action_items?.length) {
      lines.push('', 'Action items');
      for (const item of meeting.action_items) {
        const owner = item.owner ? ' — ' + item.owner : '';
        const due = item.due_date ? ' · ' + item.due_date : '';
        lines.push('• ' + item.task + owner + due);
      }
    }
    section('Open questions', meeting.questions);
    section('Follow-ups', meeting.follow_ups);
    return lines.join('\n').trim();
  }

  function timestamp(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return (hours ? String(hours).padStart(2, '0') + ':' : '') + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function groupSegments(segments, perBlock = SEGMENTS_PER_BLOCK) {
    const groups = [];
    for (let index = 0; index < segments.length; index += perBlock) groups.push(segments.slice(index, index + perBlock));
    return groups;
  }

  function blockInput(group) {
    return group.map(segment => {
      const start = segment.index * 30;
      return '[' + timestamp(start) + '–' + timestamp(start + 30) + ']\n' + (segment.transcript || '');
    }).join('\n\n');
  }

  function blockIdentity(group) {
    return group.map(segment => segment.index + ':' + String(segment.transcript || '').length).join('|');
  }

  async function persistMeetingBlock(processor, recordingId, block) {
    await processor.store.atomic(['recordings'], stores => {
      const request = stores.recordings.get(recordingId);
      request.onsuccess = () => {
        if (!request.result) return;
        const previous = Array.isArray(request.result.meetingBlocks) ? request.result.meetingBlocks : [];
        const next = previous.filter(item => item.index !== block.index).concat(block).sort((a, b) => a.index - b.index);
        stores.recordings.put({ ...request.result, meetingBlocks: next, processingState: 'processing' });
      };
    });
  }

  async function requestStructured(processor, job, config, prefs, options) {
    const response = await processor.fetch(OPENAI_RESPONSES, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.token,
        'Content-Type': 'application/json',
        'Idempotency-Key': options.idempotencyKey
      },
      body: JSON.stringify({
        model: prefs.llmModel || DEFAULTS.llmModel,
        store: false,
        instructions: options.instructions,
        input: options.input,
        text: {
          format: {
            type: 'json_schema',
            name: options.name,
            strict: true,
            schema: options.schema
          }
        }
      }),
      signal: processor.controllers.get(job.id)?.signal
    });
    const data = await parseResponse(response);
    const text = outputText(data);
    if (!text) throw new Error('OpenAI response contained no text');
    try { return JSON.parse(text); }
    catch (_) { throw new Error('OpenAI response was not valid structured JSON'); }
  }

  async function openAITranscribe(processor, job, config, prefs) {
    if (!config.token) {
      const error = new Error('Add your OpenAI API key in Settings → AI processing');
      error.retryable = false;
      throw error;
    }
    const segment = await processor.store.segment(job.recordingId, job.segmentIndex);
    if (!segment.blob && !segment.frames.length) throw new Error('Segment has no complete PCM frames');
    const form = new FormData();
    form.append('file', segment.blob || root.DKAudioCodec.wav(segment.frames), 'synap-' + job.recordingId + '-' + job.segmentIndex + '.wav');
    form.append('model', prefs.sttModel || DEFAULTS.sttModel);
    form.append('response_format', 'json');
    if (prefs.language && prefs.language !== 'auto') form.append('language', prefs.language);
    form.append('prompt', 'Meeting transcription. Preserve names, numbers, acronyms, decisions and action items. Do not summarize.');
    const response = await processor.fetch(OPENAI_TRANSCRIBE, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + config.token, 'Idempotency-Key': job.dedupe },
      body: form,
      signal: processor.controllers.get(job.id)?.signal
    });
    const data = await parseResponse(response);
    const transcript = data?.text ?? data?.transcript;
    if (typeof transcript !== 'string') throw new Error('OpenAI transcription response did not contain text');
    return { transcript: transcript.trim(), provider: 'openai', sttModel: prefs.sttModel };
  }

  async function openAIResponse(processor, job, config, prefs) {
    if (!config.token) {
      const error = new Error('Add your OpenAI API key in Settings → AI processing');
      error.retryable = false;
      throw error;
    }

    // For OpenAI, the 30-second dependency step is deliberately local. It marks the
    // transcript ready without paying for an LLM call per tiny segment. The next job
    // groups ten transcript segments into ~5-minute semantic blocks.
    if (job.kind === 'summarize') {
      const segment = await processor.store.get('segments', [job.recordingId, job.segmentIndex]);
      if (!segment || typeof segment.transcript !== 'string') throw new Error('Missing prior transcription');
      return { summary: segment.transcript.trim(), contextReady: true, provider: 'openai' };
    }

    const segments = (await processor.store.all('segments', 'recording', job.recordingId))
      .filter(segment => typeof segment.transcript === 'string' && segment.transcript.trim())
      .sort((a, b) => a.index - b.index);
    if (!segments.length) throw new Error('Missing transcript segments');

    const recording = await processor.store.get('recordings', job.recordingId);
    const savedBlocks = new Map((recording?.meetingBlocks || []).map(block => [block.index, block]));
    const groups = groupSegments(segments);
    const blocks = [];

    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const identity = blockIdentity(group);
      const existing = savedBlocks.get(index);
      if (existing?.identity === identity && existing?.memory) {
        blocks.push(existing);
        continue;
      }
      const startSeconds = group[0].index * 30;
      const endSeconds = (group[group.length - 1].index + 1) * 30;
      const memory = await requestStructured(processor, job, config, prefs, {
        idempotencyKey: job.dedupe + ':block:' + index + ':' + identity,
        name: 'synap_meeting_block',
        schema: BLOCK_SCHEMA,
        instructions: 'You are synthesizing one consecutive ~5-minute block from a longer meeting. Preserve chronology, names, numbers, commitments, decisions, changes of mind, unresolved questions and action items. Merge repetition inside this block. Do not invent owners, dates or facts. Empty strings or arrays are preferred over guesses.',
        input: blockInput(group)
      });
      const block = {
        index,
        identity,
        startSeconds,
        endSeconds,
        start: timestamp(startSeconds),
        end: timestamp(endSeconds),
        segmentStart: group[0].index,
        segmentEnd: group[group.length - 1].index,
        memory,
        model: prefs.llmModel || DEFAULTS.llmModel,
        processedAt: new Date().toISOString()
      };
      await persistMeetingBlock(processor, job.recordingId, block);
      blocks.push(block);
    }

    const finalInput = blocks.map(block => ({
      block: block.index + 1,
      time: block.start + '–' + block.end,
      memory: block.memory
    }));
    const meeting = await requestStructured(processor, job, config, prefs, {
      idempotencyKey: job.dedupe + ':final:' + blocks.map(block => block.identity).join(';'),
      name: 'synap_meeting_memory',
      schema: MEETING_SCHEMA,
      instructions: 'Consolidate these chronological meeting blocks into one reliable meeting memory. Treat blocks as consecutive parts of the same conversation. Merge duplicate points and action items. If a later block explicitly changes an earlier proposal or decision, preserve the later confirmed state while making the change understandable. Distinguish tentative discussion from confirmed decisions. Never invent owners, due dates, decisions or facts. Keep the executive summary concise and action-oriented.',
      input: JSON.stringify(finalInput)
    });

    return {
      name: meeting.title || undefined,
      summary: meetingText(meeting),
      meeting,
      meetingBlocks: blocks,
      transcript: segments.map(segment => {
        const start = segment.index * 30;
        return '[' + timestamp(start) + '] ' + segment.transcript;
      }).join('\n').trim(),
      processingState: 'done',
      provider: 'openai',
      sttModel: prefs.sttModel,
      llmModel: prefs.llmModel,
      processingStrategy: '30s-stt-5m-blocks-final',
      processedAt: new Date().toISOString()
    };
  }

  function patchProcessor() {
    const Processor = root.DKFIFOProcessor;
    if (!Processor || Processor.prototype.__synapAIProviderPatched) return;
    const original = Processor.prototype.process;
    Processor.prototype.process = async function (job, config, url) {
      const prefs = readPrefs();
      if (prefs.provider !== 'openai') return original.call(this, job, config, url);
      const controller = new AbortController();
      this.controllers.set(job.id, controller);
      const timeout = setTimeout(() => controller.abort(), 120000);
      try {
        if (job.kind === 'transcribe') return await openAITranscribe(this, job, config, prefs);
        return await openAIResponse(this, job, config, prefs);
      } finally {
        clearTimeout(timeout);
        this.controllers.delete(job.id);
      }
    };
    Processor.prototype.__synapAIProviderPatched = true;
  }

  function bindSettings() {
    if (!root.document) return;
    const provider = document.getElementById('providerInput');
    const sttModel = document.getElementById('sttModelInput');
    const llmModel = document.getElementById('llmModelInput');
    const language = document.getElementById('languageInput');
    const endpoint = document.getElementById('endpointInput');
    const llmEndpoint = document.getElementById('llmEndpointInput');
    const token = document.getElementById('tokenInput');
    const form = document.getElementById('settingsForm');
    const auto = document.getElementById('autoProcessInput');
    if (!provider || !sttModel || !llmModel || !language || !endpoint || !llmEndpoint || !token || !form) return;

    const prefs = readPrefs();
    provider.value = prefs.provider;
    sttModel.value = prefs.sttModel;
    llmModel.value = prefs.llmModel;
    language.value = prefs.language;
    if (!localStorage.getItem('synap-ai-autoprocess-initialized')) {
      auto.checked = true;
      localStorage.setItem('synap-ai-autoprocess-initialized', '1');
    }

    const customFields = document.getElementById('customEndpointFields');
    const openAIFields = document.getElementById('openAIModelFields');
    const keyLabel = document.getElementById('apiKeyLabel');
    function apply() {
      const isOpenAI = provider.value === 'openai';
      if (customFields) customFields.hidden = isOpenAI;
      if (openAIFields) openAIFields.hidden = !isOpenAI;
      if (keyLabel) keyLabel.textContent = isOpenAI ? 'OpenAI API key' : 'Access token';
      if (isOpenAI) {
        endpoint.value = OPENAI_TRANSCRIBE;
        llmEndpoint.value = OPENAI_RESPONSES;
        token.required = true;
      } else {
        token.required = false;
      }
    }
    provider.addEventListener('change', apply);
    apply();

    // Capture runs before app.js' submit handler, so its existing settings object receives the preset endpoints and key.
    form.addEventListener('submit', function (event) {
      if (provider.value === 'openai' && !token.value.trim()) {
        event.preventDefault();
        token.focus();
        document.getElementById('queueStatus').textContent = 'Add an OpenAI API key to enable transcription and meeting summaries.';
        return;
      }
      if (provider.value === 'openai') {
        endpoint.value = OPENAI_TRANSCRIBE;
        llmEndpoint.value = OPENAI_RESPONSES;
      }
      savePrefs({ provider: provider.value, sttModel: sttModel.value, llmModel: llmModel.value, language: language.value });
      setTimeout(function () {
        if (auto.checked) document.getElementById('runQueueButton')?.click();
      }, 0);
    }, true);
  }

  root.SynapAI = {
    DEFAULTS,
    BLOCK_SCHEMA,
    MEETING_SCHEMA,
    OPENAI_TRANSCRIBE,
    OPENAI_RESPONSES,
    SEGMENTS_PER_BLOCK,
    readPrefs,
    savePrefs,
    outputText,
    meetingText,
    groupSegments,
    blockInput,
    patchProcessor
  };

  patchProcessor();
  bindSettings();
})(globalThis);
