# synap — PWA only

Stay present. Keep the memory

Release 5.5.1. This repository contains only the browser application.
ESP32-S3 firmware is maintained separately and must not be committed here.

## Deploy

Serve the repository root over HTTPS (for example, GitHub Pages). No npm
installation, build step, or runtime framework is required. Upload all ten
application assets together: `index.html`, `styles.css`, `app.js`,
`audio-store.js`, `sw.js`, `manifest.webmanifest`, `logo.webp`, and the three icon files.
Verify the footer shows 5.5.1. Do not clear site data to update the app:
recordings and pending processing jobs are stored there.

Use a browser with Web Bluetooth, IndexedDB, and Web Locks support. Keep the
application open while recording or processing; background execution is not
guaranteed. Only one tab may own the recorder at a time.

## Mobile-first interface

All screen sizes use Insights, Library and Queue in that order in the bottom
navigation and page content. The compact recorder sits above the timeline;
Record, Stop & Save, elapsed time, and status stay visible. Audio and connection
metrics expand on demand. Wider screens gain spacing and a two-column Insights
layout, while Library stays a single compact list. It shows the newest five recordings for the
selected day as collapsed rows. Show more reveals five at a time; Show less
restores the compact view. Playback and editing controls load on first expansion,
and collapsing a recording pauses playback. Insights can reveal older recordings.
Settings opens as a bottom sheet on small
screens. Inputs use readable 16 px text, controls have large touch targets,
safe-area insets are respected, and reduced-motion preferences are supported.
This release does not change BLE commands, audio storage, or FIFO processing.
Branding adds one optimized logo asset and no runtime dependencies. Existing
Bluetooth device names and storage identifiers are preserved for compatibility.
The service worker serves a
complete precached release; a persistent update notice asks you to finish your
work and reload when a newer worker takes control. It never reloads automatically
or clears IndexedDB. Compare the footer version on both devices. Recordings are
device-local; this release does not add cloud sync between laptop and phone.

## Daily timeline and insights

The app opens on the current local calendar day. Seven recent-day controls and
the date picker filter Saved moments, meeting summaries, and transcripts without
changing or duplicating stored recordings. The day-at-a-glance card reports the
selected day's recording count, captured duration, summaries, and transcripts.
Insights appear only after the FIFO has produced a transcript or consolidated
summary; all content remains in the same local IndexedDB as its source recording.

## Reconnect after reload

Settings now includes **Reconnect remembered pendant** (on by default) and a
browser capability explanation. Recovery runs on page load, return to the
foreground, back/forward-cache restoration, and Bluetooth availability events
where supported. Foreground recovery is rate-limited to once per 30 seconds;
each cycle retains the existing bounded retries. It never opens a device chooser
without a tap, replaces a manual selection while permissions are loading, or
restarts recording. Turning the preference off prevents future automatic
attempts; it does not disconnect an existing connection. Manual disconnect
suppresses automatic recovery for the current page session.

Reload **ends the original GATT session**. Automatic reconnection creates a new
session; it is not uninterrupted audio capture. Browsers without
`navigator.bluetooth.getDevices()` cannot restore a device from its saved ID
alone and need device selection after reload. Retained permission, the same
browser profile/site origin, Bluetooth enabled, and advertising firmware are
required. Installing the PWA does not add missing Web Bluetooth APIs.

The last successfully connected device ID is remembered locally. On reload,
the app uses `navigator.bluetooth.getDevices()` when available to recover that
permitted device, reconnect GATT, and subscribe again to audio and status.
For older installations without a saved ID, exactly one permitted device named
`dk-pendant` is accepted. Ambiguous or revoked devices require manual selection.
After a failed automatic connection, up to three retries are scheduled. A manual
retry then offers Reselect pendant, opening the chooser directly in the user's
click so the same pendant can be selected again without visiting Settings.
Timed-out connects are cancelled, and stale-device disconnect events are ignored. An
orphaned stream is stopped before returning to idle; recording never restarts
automatically. Committed audio chunks from an interrupted take are recovered.

This requires retained permission on the same origin, a supporting browser,
Bluetooth enabled, and a nearby advertising pendant. If `getDevices()` is
unavailable, tap Connect pendant. Reloading does not preserve the old GATT
connection. A closed/suspended browser cannot guarantee an ongoing connection.

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

Run dependency-free regression checks with `node tests/reconnect.cjs`.
They cover mocked GATT and lifecycle/permission recovery plus release cache
contracts; they do not substitute for physical Android/pendant testing.
