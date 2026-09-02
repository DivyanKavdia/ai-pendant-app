# synap — PWA only

Stay present. Keep the memory

Release 1.0.0. This repository contains only the browser application.
ESP32-S3 firmware is maintained separately and must not be committed here.

## One-click firmware updates

The synchronized public version remains **1.0.0**; increasing firmware build numbers identify newer binaries. After a pendant connects, the PWA checks the verified `synap-firmware` feed, displays **Update pendant** for a newer build, and installs only after explicit user confirmation. Checks also run when the app returns to the foreground, every minute while eligible, or when **Check updates** is tapped. Updating is blocked while connecting, recording, saving, opening a capture, or holding unsaved audio.

Official target: **ESP32-S3FH4R2 / SuperMini, 4 MB QIO flash, 2 MB QSPI PSRAM, default two-slot OTA partition scheme**. Only protocol-3 application images with the exact target/build identity, size, SHA-256, chip ID and immutable raw GitHub URL from the manifest are accepted. Bootloaders, partition tables, merged images, incompatible hardware and downgrades are rejected before flashing.

No OTAKEY or signing configuration is required. The PWA reads the permanent device ID and keeps the device association automatically. Confirmation names that ID; discovery, transfer and post-reboot verification must all match it. Pending update results are persisted under the permanent ID. Switching browsers still requires normal Bluetooth permission; clearing site data creates a new association.

Connect, approve and keep the powered pendant and PWA foregrounded. The pendant compares the public target ID before flash and verifies received SHA-256 plus image compatibility. This is identification, not authorization: another nearby BLE client can also update the device. Existing firmware with the old updater requires one developer/factory USB migration; no owner-key input is exposed.

Publisher trust is currently the GitHub repository/account plus HTTPS and reviewed workflow; the manifest hash is not an independent publisher signature. Stock Arduino bootloaders may not provide rollback, so protect firmware `main`, review workflow changes, and hardware-test releases before broad rollout.

Release feed: https://raw.githubusercontent.com/DivyanKavdia/synap-firmware/ota-releases/latest.json

## Deploy

Serve the repository root over HTTPS (for example, GitHub Pages). No npm
installation, build step, or runtime framework is required. Upload all fourteen
application assets together: `index.html`, `styles.css`, `app.js`, `theme.js`,
`audio-store.js`, `ota.js`, `releases.js`, `device-identity.js`, `sw.js`, `manifest.webmanifest`, `logo.webp`, and the three icon files.
Verify the footer shows 1.0.0. Do not clear site data to update the app:
recordings and pending processing jobs are stored there.

Use a browser with Web Bluetooth, IndexedDB, and Web Locks support. Keep the
application open while recording or processing; background execution is not
guaranteed. Only one tab may own the recorder at a time.

## Mobile-first interface

Settings → Appearance offers Auto, Light and Dark. Auto follows the system theme;
an explicit choice is remembered in `synap-appearance` and applied before first paint.
Shared color roles keep cards, controls and status colors consistent in both modes.
Bottom navigation follows section positions while scrolling, including after content
expands, regardless of an earlier anchor link. Run `node tests/theme.cjs` and
`node tests/navigation.cjs` for theme/contrast and scroll-selection regressions.

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
This release preserves audio BLE commands and the audio storage schema. It adds
an optional BLE firmware updater and prevents FIFO work from starting during OTA.
Branding adds one optimized logo asset and no runtime dependencies. Existing
Bluetooth device names and storage identifiers are preserved for compatibility.
The service worker serves a complete precached release; an update notice asks
you to finish your work and reload when a newer worker takes control. It never
reloads automatically or clears IndexedDB. Compare the footer version on both
devices. Recordings are device-local; this release does not add cloud sync.

## Firmware updates over BLE

Settings → Device update checks for a verified release. When one is available, tap Update now.
Progress and Cancel appear only during an update; interrupted transfers offer Continue update.
The app verifies the pendant's permanent identity before transfer and checks the installed build
on reconnect. The only customer update flow is OTA from the verified release feed; local file
selection, developer controls and owner-key input have been removed.

Settings uses a compact connection card, recording switches, and collapsed AI processing and
audio recovery sections. Device associations remain stored internally. Diagnostic details stay
in the diagnostic log rather than the normal settings flow. No recording storage is cleared.

Transfer confirms each chunk with a Bluetooth write response and a written-byte ACK before sending
the next offset, with a SHA-256 check and read fallback for lost notifications. This also works with
installed builds 1005/1007; no USB reflash is needed for this transport fix. Keep the app open and the pendant powered. Cancel works before commit;
a link loss can resume from the pendant's saved offset for two minutes. A connected 45-second stall,
device reboot or power loss requires a new transfer. A lost commit acknowledgement is
uncertain until reconnect confirms the exact expected permanent device ID and build.
Processing remains paused until resumed from Queue.

**Security tradeoff:** IDs, hashes and markers are not authentication or firmware signatures.
Any nearby client able to establish BLE can initiate an update; PWA confirmation does not
enforce exclusive ownership on the device. No signing keys, BLE bonding, eFuse changes, Secure
Boot or boot rollback are provisioned. Keeping an old slot does not guarantee automatic
recovery from a valid but broken new app. This is not a production security qualification.
Old authorization-vault data is no longer used and is not automatically erased.

### OTA protocol 3

Existing service: 4fa12345-0000-1000-8000-00805f9b34fb.
Write-with-response: ...348; read/notify status: ...349; read-only permanent device ID: ...34c.
The ...34b firmware build identity remains separate. No challenge characteristic is used.
All integers are little-endian, and packets start with command u8 + nonzero transfer ID u32.

| Command | Remaining bytes |
| --- | --- |
| 1 Begin | image length u32, SHA-256 (32 bytes), device ID (18 UTF-8 bytes, no NUL) |
| 2 Data | offset u32, data up to advertised maxData |
| 3 Verify | none; after exactly the declared size |
| 4 Commit | none; after successful Verify |
| 5 Abort | none; not accepted after Commit |
| 6 Resume | image length u32, SHA-256 (32 bytes), device ID (18 UTF-8 bytes, no NUL) |

BEGIN is 59 bytes. Status remains 20 bytes: D7, protocol 03, state u8, error u8,
transfer ID u32, next offset u32, capacity u32, maxData u16, build u16.
States are 0 unavailable, 1 available, 2 reserved, 3 receiving, 4 verified,
5 committed, 6 failed. Error 12 is a device-ID mismatch.
maxData is 64–503 bytes. Packet writes are at most 512 bytes. Data prefers
write-without-response in eight-packet windows; control packets use write-with-response.
Only an identical repeat of the immediately previous data packet is idempotent.
The protocol marker is SYNAP-ESP32S3-OTA-ID-V3, not a cryptographic signature.

### Verification

Run node --test tests/*.cjs. Tests exercise device targeting, explicit confirmation,
legacy migration, same-ID/new-browser-handle reboot recovery, mismatched IDs,
corrupt downloads, cancellation, disconnects, uncertain commits, local associations,
audio metadata, reconnect and the offline shell. These are host tests, not physical BLE tests.

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
`synap` or `dk-pendant` is accepted. Ambiguous or revoked devices require manual selection.
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


## Device setup and persistent associations

Settings → Set up your device now consists of connecting, automatically remembering the identified pendant, and recording. Firmware updates use the same permanent device ID; no owner-key enrollment is required.

On every connection, `device-identity.js` reads `4fa1234c-0000-1000-8000-00805f9b34fb`. A valid value is `SYNAP-` plus 12 uppercase hexadecimal digits. Only after a valid idle acknowledgement on that same connection does the app persist the association. Reconnect never automatically starts recording.

The localStorage record `synap-device-associations-v1` contains schema version 1, a random `installationId` for this PWA origin, and device records with `deviceId`, a stable random `associationId`, observed browser Bluetooth IDs, display name, first connection time and last connection time. A new browser handle for the same permanent ID reuses its association; multiple pendants have separate associations. A previously mapped Bluetooth handle reporting another permanent ID is rejected without overwriting the mapping. `dk-pendant-device-id` remains the browser permission handle used for reconnect, not the permanent ID.

Settings displays the connected ID and saved devices. New recording records snapshot `deviceId`, `deviceAssociationId`, and `pwaInstallationId`; old recordings are not retrospectively assigned. Clearing site data removes local associations; a later connection creates a new installation and association. Another browser or app origin has its own mapping. This is not cloud sync, BLE bonding, exclusive ownership, or cryptographic authentication. No owner keys enter this registry or recording metadata; updates no longer use the old authorization vault.

Old firmware without the new characteristic can still record but setup reports that permanent identification is unavailable. Read failures and malformed IDs do not create associations. Storage failures are shown as identified but not saved, rather than successful setup. Install an identity-enabled firmware build once to enable automatic association on subsequent connections.

Run `node --test tests/*.cjs` for association, actual connection-handler, recording metadata, reconnect, service-worker, release and OTA regressions.
