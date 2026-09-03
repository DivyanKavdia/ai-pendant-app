# Synap Backend AI + STT Endpoint Specification

Status: implementation handoff  
PWA public version: 0.0.1  
Purpose: move model credentials and intelligence execution out of the browser while preserving Synap's local-first second-brain UX.

## 1. Product objective

Synap is not a recorder. The backend converts chronological pendant audio into durable personal memory:

`Audio -> STT -> conversation boundaries -> people/topics -> decisions/actions/follow-ups -> daily memory -> retrieval -> grounded answer`

The PWA remains responsible for BLE capture, resilient local audio journaling, offline behavior and source playback. The backend is responsible for model access, structured inference, retrieval indexing and optional cross-device synchronization.

## 2. Design principles

1. Never expose provider API keys to the PWA.
2. Every derived fact must retain source provenance: recording, segment and time range.
3. Never invent names, owners, due dates, decisions or facts.
4. Audio upload must be resumable/idempotent.
5. Support English, Hindi and Hinglish first; language may be auto-detected.
6. Keep model/provider implementation replaceable behind Synap-owned APIs.
7. Raw audio retention must be configurable; derived memory can outlive raw audio only with explicit product policy.
8. Highlight/Remember This events receive higher inference/retrieval weight but do not override source truth.
9. All writes use stable client-generated IDs/idempotency keys.
10. API schemas are versioned independently of PWA and firmware.

## 3. Recommended architecture

### Services

- API Gateway / Auth
- Ingestion Service
- STT Worker
- Memory Worker / LLM orchestration
- Retrieval Service
- User Memory Store
- Object Storage for temporary audio
- Queue/event bus
- Optional vector index

### Suggested logical data stores

Relational DB:
- users
- devices
- recordings
- audio_segments
- transcripts
- conversations
- people
- conversation_people
- topics
- memories
- decisions
- action_items
- follow_ups
- highlights
- processing_jobs

Object store:
- encrypted WAV/PCM segment objects

Vector store/index:
- conversation summaries
- transcript windows
- decisions/actions
- people/project/topic memory documents

## 4. Authentication

PWA should authenticate to Synap backend and receive a short-lived access token. Do not use an OpenAI/Gemini/Anthropic key in browser storage.

Required headers:

```http
Authorization: Bearer <synap-access-token>
X-Synap-Client: pwa
X-Synap-Schema: 1
Idempotency-Key: <uuid>
```

Device ID may be included as metadata but must not itself be authentication.

## 5. API surface

Base example: `/v1`

### 5.1 Create recording

`POST /v1/recordings`

```json
{
  "recording_id": "client-uuid",
  "device_id": "stable-pendant-id",
  "started_at": "2026-09-03T10:00:00Z",
  "sample_rate": 16000,
  "channels": 1,
  "encoding": "pcm_s16le",
  "language": "auto",
  "continuous_group_id": "uuid-or-null",
  "continuous_part": 1
}
```

Response: `201` with recording resource and upload state.

### 5.2 Upload audio segment

`PUT /v1/recordings/{recording_id}/segments/{segment_index}`

Content-Type: `audio/wav` preferred for first implementation.

Metadata headers or multipart metadata must include:
- start_ms
- end_ms
- sha256
- highlight IDs overlapping the segment

The operation must be idempotent by recording + segment index + SHA-256.

Response:

```json
{
  "segment_index": 4,
  "state": "accepted",
  "sha256": "..."
}
```

### 5.3 Close/finalize recording

`POST /v1/recordings/{recording_id}/finalize`

```json
{
  "ended_at": "2026-09-03T10:42:03Z",
  "duration_ms": 2523000,
  "segment_count": 85
}
```

Returns `202` and processing job ID.

### 5.4 Remember This / highlight

`POST /v1/recordings/{recording_id}/highlights`

```json
{
  "highlight_id": "uuid",
  "offset_ms": 834000,
  "created_at": "2026-09-03T10:13:54Z",
  "source": "pwa|pendant",
  "note": null
}
```

Backend should attach a configurable context window around the mark, e.g. -45s/+90s, when generating memory.

### 5.5 Processing status

`GET /v1/recordings/{recording_id}/processing`

```json
{
  "state": "transcribing|understanding|indexing|done|failed",
  "progress": 0.72,
  "retryable": false,
  "error_code": null
}
```

### 5.6 Get structured memory

`GET /v1/recordings/{recording_id}/memory`

Returns the canonical schema in section 7.

### 5.7 Daily brief

`GET /v1/days/{YYYY-MM-DD}/brief`

Return:
- concise narrative
- decisions
- my commitments
- waiting on others
- unresolved questions
- highlighted moments
- important people
- important topics/projects
- source IDs for every item

### 5.8 People memory

`GET /v1/people`

`GET /v1/people/{person_id}`

Person resource should include canonical name, aliases, optional user-confirmed identity, last interaction, common topics, recent conversations and open mutual commitments. Model-derived identity must be clearly distinguishable from user-confirmed identity.

### 5.9 Follow-up inbox

`GET /v1/follow-ups?state=open&owner=self|other|all`

Each item:

```json
{
  "id": "uuid",
  "task": "Send revised proposal",
  "owner": {"type":"self","person_id":null,"display_name":"Me"},
  "counterparty_person_id": "uuid-or-null",
  "due_date": "2026-09-05",
  "state": "open",
  "source": {"recording_id":"uuid","conversation_id":"uuid","start_ms":120000}
}
```

Future endpoint:
`PATCH /v1/follow-ups/{id}` for done/dismissed/edited/user-confirmed.

### 5.10 Ask Synap

`POST /v1/ask`

```json
{
  "query": "What did Ankit say about the launch?",
  "scope": {"from":null,"to":null,"people":[],"topics":[]},
  "max_sources": 8
}
```

Response:

```json
{
  "answer": "...",
  "confidence": "high|medium|low",
  "sources": [
    {
      "recording_id": "uuid",
      "conversation_id": "uuid",
      "start_ms": 300000,
      "end_ms": 360000,
      "quote": "short optional evidence excerpt"
    }
  ]
}
```

No-source answer policy: if retrieval cannot ground the answer, return an explicit not-found answer. Do not use general model knowledge to answer a personal-memory question.

## 6. STT pipeline

Input is 16 kHz mono PCM/WAV in approximately 30-second segments from the PWA.

Recommended flow:
1. validate SHA and audio metadata
2. voice activity / silence handling if useful
3. STT with timestamps
4. optional diarization
5. normalize transcript without changing meaning
6. retain segment/time provenance
7. enqueue memory extraction

STT output schema:

```json
{
  "recording_id":"uuid",
  "segment_index":3,
  "language":"hi-en",
  "text":"...",
  "words":[
    {"text":"Ankit","start_ms":91000,"end_ms":91400,"speaker":"S1","confidence":0.93}
  ],
  "speakers":["S1","S2"]
}
```

Custom vocabulary input should include user-confirmed people names, company names, project names and acronyms. It is a hint, never permission to hallucinate those terms.

## 7. Canonical structured memory schema

```json
{
  "schema_version":1,
  "recording_id":"uuid",
  "title":"Launch planning",
  "executive_summary":"...",
  "people":[
    {"person_id":"uuid-or-null","name":"Ankit","role":"colleague","evidence":"speaker introduced as Ankit","confidence":0.91}
  ],
  "topics":["Project Falcon","launch"],
  "key_points":["..."],
  "decisions":[
    {"text":"Launch on Friday","source":{"start_ms":610000,"end_ms":625000}}
  ],
  "action_items":[
    {"task":"Send final deck","owner":"self","due_date":"2026-09-04","state":"open","source":{"start_ms":700000,"end_ms":720000}}
  ],
  "follow_ups":[
    {"text":"Check legal approval","owner":"Ankit","state":"open","source":{"start_ms":730000,"end_ms":745000}}
  ],
  "conversations":[
    {
      "conversation_id":"uuid",
      "title":"Launch planning",
      "start_ms":300000,
      "end_ms":900000,
      "summary":"...",
      "people":["person-id"],
      "topics":["launch"],
      "decisions":["decision-id-or-inline"],
      "action_items":["action-id-or-inline"],
      "highlight_ids":["uuid"]
    }
  ]
}
```

Every actionable or factual object should ultimately have provenance, confidence and user-confirmation state.

## 8. Conversation segmentation

Do not equate processing blocks with conversations.

Use evidence such as:
- sustained silence / gap
- participant change
- clear context or location transition
- explicit opening/closing language
- strong topic discontinuity

Conservative rule: false merge is preferable to inventing multiple meetings from arbitrary chunk boundaries. Processing chunks can be ~5 minutes internally while conversation boundaries remain independent.

## 9. People identity model

Separate:
- speaker label: S1/S2
- extracted display name: Ankit
- canonical person: person UUID
- user-confirmed identity

Never merge two people solely because first names match. Use repeated evidence and/or user confirmation. Maintain aliases. Corrections must propagate to retrieval/index documents without rewriting the original transcript.

## 10. Memory extraction prompt contract

System intent:

> Build a reliable personal memory from chronological transcript evidence. Distinguish proposals from confirmed decisions. Extract commitments only when supported. Never invent people, owners, dates, decisions or facts. Preserve source time ranges. Treat highlighted windows as important but still evidence-bound. Segment real conversations conservatively. Return only the requested schema.

Use strict JSON-schema output where the selected model supports it.

## 11. Ask Synap retrieval

Recommended first production approach:
1. parse query into people/topic/date/action intent
2. relational filters for people/date/action state
3. hybrid keyword + vector retrieval across conversation/transcript windows
4. rerank
5. send only retrieved evidence to answer model
6. answer with source IDs/time ranges
7. reject unsupported assertions

Do not put an entire user's lifetime transcript into one prompt.

## 12. Daily brief generation

Generate incrementally from structured memories, not by retranscribing/re-reading all audio.

Sections:
- What happened
- Decisions
- You committed to
- Waiting on
- Unresolved
- Important moments
- People to follow up with

Regenerate when a recording finishes processing or an action/person correction occurs.

## 13. Reliability

- segment upload: retry with exponential backoff
- processing: queue-based and restart-safe
- model call idempotency
- poison job/dead-letter handling
- no duplicate actions on retry
- per-stage observability
- trace ID propagated through upload -> STT -> LLM -> index
- model/provider/version stored on derived records

Suggested states:
`created -> uploading -> uploaded -> transcribing -> understanding -> indexing -> ready`

Failures retain successfully completed prior stages.

## 14. Privacy/security

- TLS everywhere
- encryption at rest
- per-user authorization on every resource
- no provider training opt-in by accident
- redact secrets from logs
- configurable audio deletion
- account delete/export
- audit user corrections
- rate limits and abuse controls
- do not log full transcripts in infrastructure logs
- signed URLs for object access with short expiry

For enterprise/on-prem later, keep provider adapters and storage interfaces abstract.

## 15. PWA migration plan

Phase A — current local-first PWA:
- local IndexedDB audio journal
- browser sends segments to provider directly
- local structured memory

Phase B — Synap backend:
- replace provider URLs/API key with Synap auth + `/v1` endpoints
- retain IndexedDB as offline journal/cache
- upload closed segments asynchronously
- merge returned canonical memory into local recording object
- Ask Synap calls `/v1/ask`, with local retrieval fallback when offline

Phase C — cross-device memory:
- server canonical memory IDs
- sync cursor/change feed
- user-confirmed people/actions sync
- optional encrypted audio sync policy

## 16. PWA adapter interface

Implement a provider-neutral JS adapter later:

```js
SynapBackend.createRecording(meta)
SynapBackend.uploadSegment(recordingId,index,wav,meta)
SynapBackend.addHighlight(recordingId,highlight)
SynapBackend.finalizeRecording(recordingId,meta)
SynapBackend.processingStatus(recordingId)
SynapBackend.memory(recordingId)
SynapBackend.dailyBrief(date)
SynapBackend.people()
SynapBackend.followUps(filter)
SynapBackend.ask(query,scope)
```

This adapter should be the only PWA layer aware of backend HTTP details.

## 17. Acceptance criteria for backend v1

Backend v1 is ready when:
- a 60+ minute capture uploads incrementally without duplicate processing
- interruption/retry does not lose or duplicate segments
- Hindi/Hinglish/English transcription works
- structured output creates conservative conversation boundaries
- people, decisions, actions and follow-ups retain source time ranges
- Remember This influences importance ranking
- Ask Synap answers from retrieved personal evidence and always returns sources
- daily brief and follow-up inbox derive from canonical structured memory
- provider credentials never reach browser storage
- deleting a user's recording removes/invalidates associated indexed evidence according to retention policy

## 18. Do not implement in backend v1

- autonomous email/calendar actions
- marketplace/plugins
- generic web-answering inside Ask Synap
- emotion/personality inference
- biometric speaker identification without explicit privacy design
- large-scale on-device inference

The first backend should make Synap's memory **reliable, grounded, private and retrievable**. Everything agentic can be layered on after that foundation is trustworthy.
