# DK AI Pendant — PWA only

Release 5.0.0. This repository contains only the browser application.
ESP32-S3 firmware is maintained separately and must not be committed here.

## Deploy

Serve the repository root over HTTPS (for example, GitHub Pages). No npm
installation, build step, or runtime framework is required. Upload all nine
application assets together: `index.html`, `styles.css`, `app.js`,
`audio-store.js`, `sw.js`, `manifest.webmanifest`, and the three icon files.
Verify the footer shows 5.0.0. Do not clear site data to update the app:
recordings and pending processing jobs are stored there.

Use a browser with Web Bluetooth, IndexedDB, and Web Locks support. Keep the
application open while recording or processing; background execution is not
guaranteed. Only one tab may own the recorder at a time.

## Separate hardware interface

The PWA expects DK Pendant BLE protocol v2, PCM16 mono at 16 kHz:

- Service: `4fa12345-0000-1000-8000-00805f9b34fb`
- Audio notifications: `4fa12346-0000-1000-8000-00805f9b34fb`
- Control/status: `4fa12347-0000-1000-8000-00805f9b34fb`

Received chunks are journaled individually in IndexedDB with 100 ms batched
commits. Closed recordings are grouped into approximately 30-second segments.
The persistent FIFO performs transcription, segment summaries, then final
consolidation. A failed job blocks later jobs. Packets lost before reception
and the uncommitted tail of a browser crash cannot be recovered.

## Processing endpoints

Configure two HTTPS endpoints in Settings. No inference backend is bundled.

1. STT: multipart POST containing `audio` (WAV), `recording_id`,
   `segment_index`, and `sample_rate=16000`. Return HTTP 200 JSON
   `{"transcript":"..."}`; an empty transcript is valid for silence/test tone.
2. LLM: JSON POST with `task`, `recording_id`, `segment_index`, and `input`.
   For `summarize_segment`, input is transcript text. For `consolidate`,
   segment_index is -1 and input is an ordered array of `{index, summary}`.
   Return HTTP 200 JSON `{"summary":"..."}`.

Allow the deployed PWA origin in CORS and permit POST/OPTIONS with
Content-Type, Authorization, and Idempotency-Key headers. Persist idempotency
keys and results server-side: retries must not trigger duplicate provider
charges. Requests time out after 120 seconds. Keep provider keys on the
server; the optional PWA access token is memory-only. Treat transcripts as
untrusted data, not instructions to execute.

## Release boundary

Push only PWA changes and this setup guide to this repository. Do not add ESP
sketches, firmware binaries, release ZIPs, generated dependencies, or credentials.
Future test/build tooling belongs in source control only when deliberately
introduced; exclude it from deployed assets. JavaScript syntax and asset
references can be checked locally, but real BLE operation still requires
testing with the phone and pendant.
