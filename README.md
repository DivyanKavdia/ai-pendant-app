# synap — PWA

**Stay present. Keep the memory.**

Release **1.0.0**. This repository contains the browser application only. ESP32-S3 firmware lives in `DivyanKavdia/synap-firmware`.

## Product boundary

The pendant is intentionally **stateless for recordings**. It captures PCM audio and streams it over BLE; it does not store recordings locally. Audio, transcripts, summaries, device associations and processing state are stored in the browser/PWA.

The recorder UI therefore says **Saved in browser**, not “On-device”. Clearing site data can remove locally stored memories. Settings → System status shows storage usage and whether the browser reports storage as protected/persisted.

## Supported hardware and audio

- ESP32-S3FH4R2 / ESP32-S3 SuperMini
- 4 MB flash, 2 MB QSPI PSRAM
- default two-slot OTA partition scheme
- BLE service `4fa12345-0000-1000-8000-00805f9b34fb`
- audio `...346`, control/status `...347`
- permanent device ID `...34c`
- firmware identity `...34b`
- firmware updater write `...348`, status `...349`
- PCM16 mono, 16 kHz, 800 samples / 50 ms frame

## Recording reliability

Incoming BLE chunks are journaled to IndexedDB in short batches while recording. A take is sealed only after pending writes complete. On application recovery, unsealed takes are closed from the committed packet journal.

After sealing, each approximately 30-second segment is compacted into contiguous PCM stored in IndexedDB and its raw packet rows are removed. This materially reduces IndexedDB object overhead without adding any storage to the pendant.

BLE sequence gaps are preserved on the audio timeline. Missing frame positions are represented by silence instead of collapsing time, so playback/transcription timing is not shifted forward when radio packets were lost. The recording metadata separately reports complete, incomplete and missing frames.

The browser requests persistent storage when supported, but browser eviction policy remains outside the app's control. Settings → System status reports quota/usage and warns at high usage. Recovery controls can export audio if normal finalization fails.

## Your digital twin

Insights includes **Search your memory…**. It searches recording names, notes, summaries and transcripts across locally stored recordings and ranks matches without uploading the library to a search service. Selecting a result switches the timeline to the original date and opens the recording.

This is local retrieval, not cloud sync. Another browser or cleared site profile has a separate memory library.

## AI processing queue

Processing remains browser-controlled and uses user-configured HTTPS STT/LLM endpoints.

- Stable `Idempotency-Key` values are sent for every job.
- Transcription → segment summary → recording consolidation ordering is preserved within each recording.
- Up to two **different recordings** can process concurrently.
- Two dependent jobs for the same recording never run together.
- A permanently failed recording does not block unrelated recordings.
- Retryable HTTP 408/409/425/429 and 5xx responses use exponential backoff, capped at 60 seconds and five attempts.
- Other HTTP errors fail that recording immediately and can be retried manually.
- Web Locks prevent another tab from processing the same local queue concurrently.
- Firmware OTA pauses processing.

Expected endpoints:

1. STT: multipart POST containing `audio`, `recording_id`, `segment_index`, `sample_rate=16000`; return `{"transcript":"..."}` or text.
2. LLM: JSON POST with `task`, `recording_id`, `segment_index`, `input`; return `{"summary":"..."}` or text.

Keep provider secrets server-side. The optional PWA bearer token is session-memory only.

## Signed one-click firmware updates

Normal users never paste OTA keys or choose firmware files. The PWA targets the permanent `SYNAP-XXXXXXXXXXXX` device ID and downloads only from the production `ota-releases` feed.

Production manifests use schema 2 and must be signed with **ES256 / P-256**, key ID `prod-2026-01`. The PWA embeds only the public verification key. It verifies the publisher signature before downloading, then verifies size, SHA-256, target identity, ESP32-S3 image header, device ID and installed build before commit.

The already-deployed unsigned production feed is accepted only through **build 1008** as a migration bridge. Any production build above 1008 must have a valid Synap publisher signature. This allows existing build-1008 pendants to receive the first signed release without USB reflashing.

Production feed:

`https://raw.githubusercontent.com/DivyanKavdia/synap-firmware/ota-releases/latest.json`

### OTA transfer behavior

Protocol 3 supports BEGIN, DATA, VERIFY, COMMIT, ABORT and RESUME. The PWA sends a conservative four-packet write-with-response window on real Web Bluetooth, then waits for the firmware's cumulative persisted offset. This reduces round trips while preserving exact-offset recovery and compatibility with build 1008.

A BLE interruption can resume for up to two minutes while the firmware process remains powered and its in-RAM OTA session is alive. Power loss restarts the transfer because there is deliberately no pendant-local OTA session storage. A connected transfer timeout fails closed and may be retried cleanly.

## Release-channel separation

Firmware `main` pushes publish to the **test** channel (`ota-test`) only. They are not visible to normal PWA update checks.

A production firmware release is a deliberate GitHub Actions `workflow_dispatch` with channel `production`. The protected production job requires the repository/environment secret:

`SYNAP_RELEASE_PRIVATE_KEY_PEM`

The production job signs the manifest, atomically publishes manifest + immutable binary to `ota-releases`, and verifies public CORS, digest and signature policy. If the signing secret is absent, production publication fails closed.

## PWA updates and offline shell

`sw.js` precaches one complete shell revision. It never clears IndexedDB. A newer worker can surface an update banner; Reload is disabled while recording, saving or updating firmware.

Current shell revision: `1.0.0-prod2`.

Deploy all app assets together over HTTPS. Required runtime capabilities are Web Bluetooth, IndexedDB and Web Locks. Background BLE/audio execution is not guaranteed; keep the app open while recording and during firmware updates.

## Device association and reconnect

On each connection the PWA reads the permanent `...34c` device ID. Browser Bluetooth handles are mapped to that identity only after the same connection reaches a valid idle state. A handle that later reports a different permanent ID is rejected.

When supported, `navigator.bluetooth.getDevices()` restores a previously permitted pendant after reload. Reconnect never restarts recording automatically. Manual disconnect suppresses automatic reconnect in the current page session.

Clearing site data removes browser associations and recordings but does not change the hardware's permanent ID.

## Diagnostics

Settings → Diagnostics provides copy, clear and **Download log**. Settings → System status reports:

- browser storage usage/quota and persistence status
- offline/service-worker readiness
- network online/offline state

The firmware also exposes read-only runtime diagnostics on `4fa1234d-0000-1000-8000-00805f9b34fb`, including reset reason, capture drops, notification rejects, control-queue drops, free heap, minimum free heap and uptime.

## Tests

Run all dependency-free browser regressions with:

```bash
node --test tests/*.cjs
```

The suite covers device identity/reconnect, OTA targeting/resume, production release validation, shell behavior, theme/navigation, library UX, diagnostics, signed-release migration policy and audio timeline gap preservation.

These tests do not replace physical Android/iPhone-compatible Web Bluetooth browser + pendant validation. Production firmware promotion should follow a hardware smoke test of connection, record/save, OTA interruption/resume and post-reboot reconnect.
