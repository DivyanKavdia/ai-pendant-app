# synap — PWA only

Stay present. Keep the memory

Release 1.0.0. This repository contains only the browser application.
ESP32-S3 firmware is maintained separately and must not be committed here.

## One-click firmware updates

The synchronized public version remains **1.0.0**; increasing firmware build numbers identify newer binaries. After a pendant connects, the PWA checks the verified `synap-firmware` feed, displays **Update pendant** for a newer build, and installs only after explicit user confirmation. Checks also run when the app returns to the foreground, every minute while eligible, or when **Check updates** is tapped. Updating is blocked while connecting, recording, saving, opening a capture, or holding unsaved audio.

Official target: **ESP32-S3FH4R2 / SuperMini, 4 MB QIO flash, 2 MB QSPI PSRAM, default two-slot OTA partition scheme**. Only protocol-2 application images with the exact target/build identity, size, SHA-256, chip ID and immutable raw GitHub URL from the manifest are accepted. Bootloaders, partition tables, merged images, incompatible hardware and downgrades are rejected before flashing.

One-time enrollment still needs the owner key: with OTA-enabled firmware installed, send `OTAKEY` plus newline over USB Serial at 115200. Paste it once and enable **Remember authorization on this trusted browser**. The key is imported as a non-extractable HMAC-SHA-256 `CryptoKey`, saved per Bluetooth device ID in IndexedDB only after an authenticated GitHub transfer, and never stored as plaintext or localStorage. **Forget saved authorization** removes it. Anyone controlling that browser/origin can still authorize an update, so do not remember it on shared devices. Clearing site data or replacing/resetting the pendant requires enrollment again.

After enrollment, normal updates need no USB or BOOT-button press: connect, approve, and keep the powered pendant and PWA foregrounded. The browser verifies the download before BLE transfer; the pendant independently verifies authorization and flashed SHA-256. Success appears only after reconnecting and reading the exact expected build and hardware identity. A lost commit acknowledgement is verified after reboot, never automatically retransmitted.

Publisher trust is currently the GitHub repository/account plus HTTPS and reviewed workflow; the manifest hash is not an independent publisher signature. Stock Arduino bootloaders may not provide rollback, so protect firmware `main`, review workflow changes, and hardware-test releases before broad rollout.

Release feed: https://raw.githubusercontent.com/DivyanKavdia/synap-firmware/ota-releases/latest.json

## Deploy

Serve the repository root over HTTPS (for example, GitHub Pages). No npm
installation, build step, or runtime framework is required. Upload all eleven
application assets together: `index.html`, `styles.css`, `app.js`,
`audio-store.js`, `ota.js`, `sw.js`, `manifest.webmanifest`, `logo.webp`, and the three icon files.
Verify the footer shows 1.0.0. Do not clear site data to update the app:
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
This release preserves audio BLE commands and the audio storage schema. It adds
an optional BLE firmware updater and prevents FIFO work from starting during OTA.
Branding adds one optimized logo asset and no runtime dependencies. Existing
Bluetooth device names and storage identifiers are preserved for compatibility.
The service worker serves a complete precached release; an update notice asks
you to finish your work and reload when a newer worker takes control. It never
reloads automatically or clears IndexedDB. Compare the footer version on both
devices. Recordings are device-local; this release does not add cloud sync.

## Firmware updates over BLE

Settings → Pendant firmware → Check pendant. Firmware without the OTA
characteristics shows an initial-USB-install message and still records normally.
Use [Synap ESP32-S3 firmware releases](https://github.com/DivyanKavdia/synap-firmware/releases). Build 503 was the initial 1.0.0 baseline; official CI builds start at 1001.
Firmware 5.2+ supports PWA-only approval with no BOOT press. An existing 5.1
pendant needs its old BOOT unlock one final time to migrate, or a USB install.
No firmware files belong in this PWA repository.

1. Install the OTA-enabled firmware once by USB, using a partition scheme with
   `ota_0`, `ota_1`, and `otadata`. A later BLE update cannot change the partition
   table or bootloader. The application image must fit the displayed inactive slot.
2. After installing 5.2+, send `OTAKEY` with a newline in USB Serial Monitor at
   115200 baud. Save the device-generated 64-character owner key privately. This
   is a one-time setup step; subsequent updates need neither USB nor BOOT.
The following steps describe the optional **manual file fallback**. For ordinary
updates use **Update pendant / Install GitHub update** instead; no file selection
is needed and remembered authorization is used automatically.

3. Compile/export a trusted Synap **application .bin** for the same physical board,
   microphone configuration, flash and PSRAM settings. Do not use a merged image.
4. Connect in the PWA and stop/save recording. Check pendant, select the .bin,
   paste your owner key and approve the update. This manual fallback does not save
   the key or send it over BLE. The input clears after an attempt or disconnect.
5. Click Update firmware. The app hashes the local file and sends it directly over
   BLE, sequentially, waiting for the device's written-byte ACK for each chunk.
   The file is not sent to a web server or saved to IndexedDB.
6. The ESP checks SHA-256, the full ESP image, and the Synap compatibility marker,
   then selects the new application slot and reboots. Reconnect and Check pendant
   to read its running build. Resume processing from Queue when ready.

Keep the app visible and the pendant close and powered throughout (transfers may
take several minutes). Cancel is available before final commit. A dropped link,
reload or 45-second stalled transfer aborts an uncommitted session; reconnect,
authorize and restart from byte zero. An ACK lost during commit is reported as
uncertain, not as a successful or cancelled installation: reconnect and verify.
Normal remembered-device reconnect remains subject to browser support.

Security: a per-device 256-bit key authorizes the exact image using a one-use
challenge and HMAC-SHA256. The ESP checks authorization before opening flash.
Wrong keys and replayed approval fail; rate limiting survives BLE reconnect.
Normal OTA retains the owner key in device NVS; erasing NVS/all flash replaces it.
Anyone with Serial access can retrieve the key; device NVS encryption is not set up.
The owner key, SHA-256 and product marker do not prove publisher identity.
This build does not provision signing keys, enforce
BLE bonding, burn eFuses, or enable secure boot. Install only trusted local files.
Cryptographically signed releases should precede unattended/distributed updates.
Keeping the old slot does not guarantee recovery from a valid but broken new app:
automatic boot rollback requires a rollback-enabled bootloader; otherwise use USB.

### OTA protocol 2 (protocol 1 migration supported)

The existing pendant service UUID is reused, so no new permission scope is needed.
Write-with-response: `4fa12348-0000-1000-8000-00805f9b34fb`.
Read/notify status: `4fa12349-0000-1000-8000-00805f9b34fb`.
Read-only 16-byte challenge: `4fa1234a-0000-1000-8000-00805f9b34fb`.
All integer fields are little-endian. Every command includes a nonzero random
32-bit transfer ID immediately after its command byte.

| Command | Byte layout after command + transfer ID |
| --- | --- |
| 1 Begin | image size u32, SHA-256 32 bytes, HMAC-SHA256 32 bytes (HMAC omitted in legacy v1) |
| 2 Data | byte offset u32, data (up to advertised maxData) |
| 3 Verify | none; allowed only after exactly image size bytes |
| 4 Commit | none; allowed only after successful Verify |
| 5 Abort | none; not accepted after Commit |

MAC input: UTF-8 `SYNAP-OTA-V2` (no NUL), challenge 16 bytes, BEGIN's first 41
bytes. MAC key: the raw 32 bytes decoded from the owner's 64 hex characters.
Every consumed attempt changes the challenge; reconnect changes it too. The
PWA uses native WebCrypto; there is no new runtime dependency. Firmware 5.2+
requires the `SYNAP-ESP32S3-OTA-AUTH-V2` marker to avoid accidental legacy downgrade.
The public marker is a compatibility check, not a signature.

Status is 20 bytes: magic `D7`, protocol `02` (`01` for legacy), state u8, error u8, transfer ID u32,
next offset u32, inactive slot size u32, maxData u16, firmware build u16. States:
0 unavailable, 1 awaiting owner approval, 2 legacy armed, 3 receiving, 4 verified, 5 committed, 6 failed.
Errors 12/13 are failed/throttled authorization. Wait 30 seconds after throttling.
The ESP caps writes at 182 bytes and requires data capacity of at least 64 bytes
(MTU 76) for v2, so the 73-byte BEGIN fits; legacy v1 requires 36 data bytes.
the app uses the advertised size. Notifications have a read-back fallback.
Only an identical repeat of the immediately preceding data packet is idempotent.
Old sessions and out-of-order/corrupt duplicate data cannot advance the transfer.

### Verification

Run `node tests/reconnect.cjs`, `node tests/ota.cjs`, and `node tests/ota-ui.cjs`.
These are mock transport/integration tests, not a physical BLE or firmware compile
claim. Firmware protocol tests and the board-test checklist ship separately.

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


## Device setup and persistent associations

Settings → Set up your device now consists of connecting, automatically remembering the identified pendant, and recording. Firmware updates and owner-key authorization are separate optional settings.

On every connection, `device-identity.js` reads `4fa1234c-0000-1000-8000-00805f9b34fb`. A valid value is `SYNAP-` plus 12 uppercase hexadecimal digits. Only after a valid idle acknowledgement on that same connection does the app persist the association. Reconnect never automatically starts recording.

The localStorage record `synap-device-associations-v1` contains schema version 1, a random `installationId` for this PWA origin, and device records with `deviceId`, a stable random `associationId`, observed browser Bluetooth IDs, display name, first connection time and last connection time. A new browser handle for the same permanent ID reuses its association; multiple pendants have separate associations. A previously mapped Bluetooth handle reporting another permanent ID is rejected without overwriting the mapping. `dk-pendant-device-id` remains the browser permission handle used for reconnect, not the permanent ID.

Settings displays the connected ID and saved devices. New recording records snapshot `deviceId`, `deviceAssociationId`, and `pwaInstallationId`; old recordings are not retrospectively assigned. Clearing site data removes local associations; a later connection creates a new installation and association. Another browser or app origin has its own mapping. This is not cloud sync, BLE bonding, exclusive ownership, or cryptographic authentication. No owner keys enter this registry or recording metadata; the OTA authorization vault is unchanged.

Old firmware without the new characteristic can still record but setup reports that permanent identification is unavailable. Read failures and malformed IDs do not create associations. Storage failures are shown as identified but not saved, rather than successful setup. Install an identity-enabled firmware build once to enable automatic association on subsequent connections.

Run `node --test tests/*.cjs` for association, actual connection-handler, recording metadata, reconnect, service-worker, release and OTA regressions.
