# synap — PWA

**Stay present. Keep the memory.**

## Known-good baseline — 4 September 2026

This README is the product/engineering reference for the best-known Synap PWA state as of **4 September 2026**.

- PWA product version: **1.0.0**
- Firmware production baseline: **ESP32-S3 build 1052**
- S3 target: `esp32s3-fh4r2-qspi-4m`
- Recording protocol: **2**
- OTA protocol: **3**
- Production pendant: ESP32-S3 SuperMini + real I2S microphone + TTP223 touch sensor on GPIO13.

## Product boundary

The pendant is intentionally **stateless for recordings**. It captures PCM audio and streams it over BLE; it does not store recording audio locally. Audio, packet journal, recordings, transcripts, summaries, device associations, Remember markers and processing state live in the browser/PWA.

Clearing site data can remove local memories. Persistent browser storage is requested when available, but browser/OS eviction and background execution remain platform-controlled.

## Supported hardware / BLE

Primary production hardware is ESP32-S3FH4R2 / ESP32-S3 SuperMini with 4 MB flash and 2 MB QSPI PSRAM. The firmware project also maintains an explicit ESP32-C3 SuperMini target.

BLE service: `4fa12345-0000-1000-8000-00805f9b34fb`

- audio `...346`
- control/status `...347`
- OTA write `...348`
- OTA status `...349`
- firmware identity `...34b`
- permanent device ID `...34c`
- diagnostics `...34d`

Audio is PCM16 mono at 16 kHz, 800 samples per 50 ms frame.

## Physical touch UX

The PWA and firmware support the pendant-first gesture model:

| Pendant state | Touch gesture | User action |
| --- | --- | --- |
| Connected + idle | Long press (~1.2 s) | Start recording |
| Recording | Long press (~1.2 s) | **Remember This** marker; continue recording |
| Recording | Double tap (within ~500 ms) | Stop and finalize recording |
| Idle | Very long press (~3 s) | Enter deep sleep |
| Deep sleep | Touch/wake | Wake pendant and resume advertising/reconnect path |

The TTP223 input is GPIO13 on production S3. Firmware debounces the input (~35 ms) and guards gestures during OTA.

### Remember This

A hardware Remember gesture produces a dedicated firmware event. The PWA persists the marker against the active recording with its timeline offset so later memory/AI experiences can distinguish a user-highlighted moment without stopping the recording.

## Recording reliability

Incoming BLE chunks are journaled to IndexedDB in short batches while recording. A take is sealed only after pending writes complete. Recovery can close unsealed takes from committed packet data.

Approximately 30-second sections are compacted into contiguous PCM after sealing to reduce IndexedDB row overhead. BLE sequence gaps remain represented on the audio timeline as silence so playback/transcription timing does not collapse when radio packets are missing.

### Screen lock / background behavior

A September 4 fix prevents the foreground audio-stall watchdog from immediately false-stopping an active recording merely because the page was hidden/suspended. When the page becomes visible again, the PWA allows a recovery grace period before declaring the audio stream stalled and reacquires Screen Wake Lock where supported.

There is an unavoidable platform boundary: if the mobile OS/browser actually disconnects Web Bluetooth/GATT while the screen is locked, the pendant cannot preserve audio from that disconnected interval because Synap deliberately has no pendant-local recording storage. Diagnostics should therefore distinguish **page suspension** from a real **GATT disconnected** event.

For highest reliability during long recordings, keep the PWA active and permit the requested screen wake lock. The recovery logic is designed to tolerate browser suspension where the underlying BLE connection survives; it cannot override OS-level Web Bluetooth termination.

## Device identity and reconnect

The PWA reads the permanent `SYNAP-XXXXXXXXXXXX` device identity from the connected pendant. Browser Bluetooth handles are mapped to that identity only after a valid connection is acknowledged. The identity survives firmware updates and removes the old user-facing OTA-key workflow.

Where `navigator.bluetooth.getDevices()` is supported, a previously authorized pendant can be restored/reconnected without reopening the Bluetooth chooser. Manual disconnect suppresses automatic reconnect for that page session. Reconnect does not silently create a new recording unless the physical interaction state explicitly requires the existing recording lifecycle to be bridged.

## One-click firmware OTA

Normal users do not paste OTA keys, select binary files, connect USB, or press an ESP boot button for routine updates. The PWA reads the pendant target/build, fetches the production release manifest, verifies compatibility and downloads the immutable firmware binary.

Production firmware currently uses manifest schema 3 with GitHub Actions provenance metadata. Runtime OTA deliberately does **not** depend on GitHub REST API calls, avoiding unauthenticated REST HTTP 403/rate-limit failures. The PWA still validates the constrained production manifest, content-addressed binary URL, target/build identity, size, SHA-256 and ESP image before flashing.

Production feed is the `ota-releases/latest.json` file in `DivyanKavdia/synap-firmware`; as of this baseline its S3 build is **1052**.

### OTA transfer behavior

OTA protocol 3 supports BEGIN, DATA, VERIFY, COMMIT, ABORT and RESUME. Transfer uses bounded BLE packets/windows and firmware-reported persisted offset. A short BLE interruption can reconnect and resume while the firmware OTA session remains alive rather than intentionally restarting at byte zero. Power loss still requires a fresh transfer because OTA session state is not persisted to local pendant storage.

Firmware update checks must compare the **connected pendant build** with the manifest selected for the pendant's actual hardware target. A Git commit by itself does not mean a new firmware release exists; production `latest.json` is authoritative.

## PWA updates / service worker

The service worker caches the application shell for offline startup but does not clear IndexedDB. Same-origin app assets are refreshed through the deployed PWA. Reload/update actions must not interrupt recording, saving or firmware OTA.

A September 4 validation run exposed a stale regression-test expectation for an older service-worker cache revision. GitHub Pages deployment itself succeeded; the test expectation must track the current shell revision rather than being treated as a firmware publication failure.

## AI processing and digital twin

Insights provides local memory search across recording names, notes, summaries and transcripts. Selecting a result opens the original recording/date. This is browser-local retrieval, not cloud synchronization.

AI processing remains browser-controlled through user-configured HTTPS STT/LLM endpoints. Jobs use stable idempotency keys, preserve transcription → segment summary → recording consolidation ordering, isolate permanent failures by recording and recover interrupted `running` jobs to pending state. Firmware OTA pauses AI processing.

## Diagnostics

Settings → Diagnostics / System status is the first place to investigate field failures. It can surface/log:

- connected pendant state and identity
- firmware build/target where available
- GATT disconnect/reconnect behavior
- reset reason
- capture/notification/control drop counts
- free/minimum heap and uptime
- browser storage usage/persistence
- network/service-worker state

For a screen-lock recording complaint, specifically determine whether the log shows a real **GATT disconnected** event. If not, treat it as browser suspension/watchdog recovery rather than a physical pendant disconnect.

## Tests and production discipline

Run dependency-free browser regressions with:

```bash
node --test tests/*.cjs
```

Tests cover identity/reconnect, OTA targeting/resume, release validation, shell behavior, library UX, diagnostics, AI failure isolation and audio timeline preservation. They complement rather than replace hardware smoke testing.

Before calling a release production-good, validate at minimum: BLE connect/reconnect, real-mic recording, touch long-press start, Remember marker, double-tap stop/save, deep sleep/wake, screen-off/resume behavior, OTA update/resume, reboot and post-update reconnect.

Treat **4 September 2026 + firmware build 1052 + this PWA baseline** as the known-good reference point for subsequent regression analysis.