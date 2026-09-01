import {
  PROTOCOL_VERSION,
  UUIDS,
  COMMAND,
  DEVICE_STATE,
  ERROR_TEXT,
  EXPECTED_FRAME_BYTES,
  EXPECTED_SAMPLE_RATE,
  parseAudioPacket,
  parseStatusPacket,
  calculateFrameLayout,
  forwardSequenceDistance,
  combineBlocks,
  buildWavBlob,
} from "./protocol.js";

const FRAME_TIMEOUT_MS = 750;
const UI_REFRESH_MS = 200;
const CAPTURE_WARNING_BYTES = 60 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const ui = {
  connect: $("connectButton"),
  disconnect: $("disconnectButton"),
  start: $("startButton"),
  stop: $("stopButton"),
  play: $("playButton"),
  download: $("downloadButton"),
  clear: $("clearButton"),
  connection: $("connectionStatus"),
  device: $("deviceName"),
  firmware: $("firmwareStatus"),
  transport: $("transportStatus"),
  message: $("message"),
  packets: $("packetsValue"),
  frames: $("framesValue"),
  missing: $("missingValue"),
  invalid: $("invalidValue"),
  bytes: $("bytesValue"),
  duration: $("durationValue"),
  packetSize: $("packetSizeValue"),
  level: $("levelBar"),
  waveform: $("waveformCanvas"),
  healthRing: document.querySelector(".ring-value"),
  log: $("eventLog"),
  player: $("audioPlayer"),
};

let bluetoothDevice = null;
let gattServer = null;
let audioCharacteristic = null;
let controlCharacteristic = null;
let captureActive = false;
let firmwareStatus = null;
let playerObjectUrl = null;
let lastUiRefresh = 0;
let memoryWarningShown = false;
let pendingWaveformPcm = null;
let waveformAnimationFrame = 0;

const pendingFrames = new Map();
const pcmBlocks = [];
let pcmByteLength = 0;
let lastObservedFrameSequence = null;

const stats = {
  notifications: 0,
  completeFrames: 0,
  incompleteFrames: 0,
  sequenceGaps: 0,
  invalidPackets: 0,
  duplicatePackets: 0,
  receivedBytes: 0,
  minPacketSize: null,
  maxPacketSize: 0,
};

function setMessage(text, type = "info") {
  ui.message.textContent = text;
  ui.message.dataset.type = type;
}

function log(text) {
  const timestamp = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.textContent = `${timestamp}  ${text}`;
  ui.log.prepend(line);
  while (ui.log.children.length > 80) ui.log.lastElementChild.remove();
}

function connected() {
  return Boolean(bluetoothDevice?.gatt?.connected);
}

function setConnectionState(isConnected) {
  ui.connection.dataset.state = isConnected ? "connected" : "disconnected";
  const label = ui.connection.lastElementChild;
  if (label) label.textContent = isConnected ? "Connected" : "Disconnected";
  document.body.dataset.streaming = isConnected && captureActive
    ? "true"
    : "false";
}

function updateButtons() {
  const isConnected = connected();
  ui.connect.disabled = isConnected;
  ui.disconnect.disabled = !isConnected;
  ui.start.disabled = !isConnected || captureActive;
  ui.stop.disabled = !isConnected || !captureActive;
  ui.play.disabled = pcmByteLength === 0 || captureActive;
  ui.download.disabled = pcmByteLength === 0;
  ui.clear.disabled = pcmByteLength === 0 || captureActive;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function updateStats(force = false) {
  const now = performance.now();
  if (!force && now - lastUiRefresh < UI_REFRESH_MS) return;
  lastUiRefresh = now;

  ui.packets.textContent = stats.notifications.toLocaleString();
  ui.frames.textContent = stats.completeFrames.toLocaleString();
  ui.missing.textContent = (
    stats.incompleteFrames + stats.sequenceGaps
  ).toLocaleString();
  ui.invalid.textContent = stats.invalidPackets.toLocaleString();
  ui.bytes.textContent = formatBytes(pcmByteLength);
  ui.duration.textContent = formatDuration(
    pcmByteLength / (EXPECTED_SAMPLE_RATE * 2)
  );
  ui.packetSize.textContent = stats.minPacketSize === null
    ? "—"
    : stats.minPacketSize === stats.maxPacketSize
      ? `${stats.maxPacketSize} B`
      : `${stats.minPacketSize}–${stats.maxPacketSize} B`;

  const failedFrames = stats.incompleteFrames + stats.sequenceGaps;
  const qualityTotal = stats.completeFrames + failedFrames + stats.invalidPackets;
  const quality = qualityTotal === 0 ? 0 : stats.completeFrames / qualityTotal;
  const ringCircumference = 301.6;
  ui.healthRing.style.strokeDashoffset = String(
    ringCircumference * (1 - quality)
  );
  ui.healthRing.style.stroke = quality > 0.98
    ? "var(--green)"
    : quality > 0.85
      ? "var(--amber)"
      : "var(--violet)";
  updateButtons();
}

function resetCapture() {
  pendingFrames.clear();
  pcmBlocks.length = 0;
  pcmByteLength = 0;
  lastObservedFrameSequence = null;
  memoryWarningShown = false;
  Object.assign(stats, {
    notifications: 0,
    completeFrames: 0,
    incompleteFrames: 0,
    sequenceGaps: 0,
    invalidPackets: 0,
    duplicatePackets: 0,
    receivedBytes: 0,
    minPacketSize: null,
    maxPacketSize: 0,
  });
  ui.level.style.width = "0%";
  drawIdleWaveform();
  releasePlayerUrl();
  ui.player.removeAttribute("src");
  updateStats(true);
}

function releasePlayerUrl() {
  if (playerObjectUrl) URL.revokeObjectURL(playerObjectUrl);
  playerObjectUrl = null;
}

async function writeControl(command) {
  if (!controlCharacteristic || !connected()) {
    throw new Error("Pendant is not connected");
  }
  const value = Uint8Array.of(command, PROTOCOL_VERSION);
  if (typeof controlCharacteristic.writeValueWithResponse === "function") {
    await controlCharacteristic.writeValueWithResponse(value);
  } else {
    await controlCharacteristic.writeValue(value);
  }
}

async function connectPendant() {
  if (!navigator.bluetooth) {
    setMessage(
      "Web Bluetooth is unavailable. Use Chrome on Android/desktop and open this PWA in a secure context.",
      "error"
    );
    return;
  }

  try {
    setMessage("Choose dk-pendant from the Bluetooth device list…");
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [UUIDS.service] }],
    });
    bluetoothDevice.addEventListener(
      "gattserverdisconnected",
      handleDisconnected
    );

    gattServer = await bluetoothDevice.gatt.connect();
    const service = await gattServer.getPrimaryService(UUIDS.service);
    audioCharacteristic = await service.getCharacteristic(UUIDS.audio);
    controlCharacteristic = await service.getCharacteristic(UUIDS.control);

    // Subscribe before START. This ordering removes the original race.
    controlCharacteristic.addEventListener(
      "characteristicvaluechanged",
      handleStatusNotification
    );
    await controlCharacteristic.startNotifications();

    audioCharacteristic.addEventListener(
      "characteristicvaluechanged",
      handleAudioNotification
    );
    await audioCharacteristic.startNotifications();

    // Allow CCCD writes to settle before querying or starting the stream.
    await new Promise((resolve) => setTimeout(resolve, 150));

    setConnectionState(true);
    ui.device.textContent = bluetoothDevice.name || "dk-pendant";
    setMessage("Connected. Checking negotiated BLE transport…", "success");
    log("Connected and subscribed to control + audio notifications");
    updateButtons();
    await writeControl(COMMAND.getStatus);
  } catch (error) {
    log(`Connection failed: ${error.message}`);
    setMessage(`Connection failed: ${error.message}`, "error");
    await disconnectPendant(false);
  }
}

async function disconnectPendant(sendStop = true) {
  try {
    if (sendStop && connected() && controlCharacteristic) {
      await writeControl(COMMAND.stop);
    }
  } catch (error) {
    log(`STOP before disconnect failed: ${error.message}`);
  }

  captureActive = false;
  if (bluetoothDevice?.gatt?.connected) bluetoothDevice.gatt.disconnect();
  cleanupConnection();
  setConnectionState(false);
  ui.device.textContent = "No pendant connected";
  ui.firmware.textContent = "Waiting";
  ui.transport.textContent = "Not negotiated";
  setMessage("Pendant disconnected.");
  updateButtons();
}

function handleDisconnected() {
  captureActive = false;
  cleanupConnection();
  setConnectionState(false);
  ui.device.textContent = "No pendant connected";
  ui.firmware.textContent = "Waiting";
  ui.transport.textContent = "Not negotiated";
  setMessage("Bluetooth connection was lost. Captured audio is still available.", "error");
  log("GATT disconnected");
  updateButtons();
}

function cleanupConnection() {
  if (audioCharacteristic) {
    audioCharacteristic.removeEventListener(
      "characteristicvaluechanged",
      handleAudioNotification
    );
  }
  if (controlCharacteristic) {
    controlCharacteristic.removeEventListener(
      "characteristicvaluechanged",
      handleStatusNotification
    );
  }
  gattServer = null;
  audioCharacteristic = null;
  controlCharacteristic = null;
  firmwareStatus = null;
  pendingFrames.clear();
}

function handleStatusNotification(event) {
  try {
    firmwareStatus = parseStatusPacket(event.target.value);
    if (firmwareStatus.error === 0 && firmwareStatus.chunksPerFrame > 0) {
      const expectedLayout = calculateFrameLayout(firmwareStatus.peerMtu);
      if (
        expectedLayout.attValueCapacity !== firmwareStatus.attValueCapacity ||
        expectedLayout.chunksPerFrame !== firmwareStatus.chunksPerFrame ||
        expectedLayout.payloadBytes !== firmwareStatus.payloadBytes
      ) {
        throw new Error("Firmware transport layout does not match protocol v2");
      }
    }
    const stateText = DEVICE_STATE[firmwareStatus.state] ||
      `State ${firmwareStatus.state}`;
    const errorText = ERROR_TEXT[firmwareStatus.error] ||
      `Error ${firmwareStatus.error}`;

    ui.firmware.textContent = `Protocol v${firmwareStatus.protocolVersion} · ${stateText}`;
    ui.transport.textContent = firmwareStatus.chunksPerFrame
      ? `MTU ${firmwareStatus.peerMtu} · ${firmwareStatus.chunksPerFrame} chunks × ~${firmwareStatus.payloadBytes} B`
      : `MTU ${firmwareStatus.peerMtu} · unavailable`;

    captureActive = firmwareStatus.state === 2;
    setConnectionState(true);

    if (firmwareStatus.protocolVersion !== PROTOCOL_VERSION) {
      setMessage(
        `Protocol mismatch: PWA v${PROTOCOL_VERSION}, firmware v${firmwareStatus.protocolVersion}.`,
        "error"
      );
    } else if (firmwareStatus.error !== 0) {
      setMessage(`${errorText}. ${transportAdvice(firmwareStatus.error)}`, "error");
    } else if (captureActive) {
      setMessage("Receiving PCM16 test audio…", "success");
    } else {
      setMessage("Transport ready. Press Start recording.", "success");
    }

    log(
      `Status: ${stateText}; MTU=${firmwareStatus.peerMtu}; ` +
      `chunks=${firmwareStatus.chunksPerFrame}; error=${errorText}`
    );
    updateButtons();
  } catch (error) {
    stats.invalidPackets += 1;
    log(`Invalid status notification: ${error.message}`);
    setMessage(`Invalid firmware status: ${error.message}`, "error");
    updateStats(true);
  }
}

function transportAdvice(errorCode) {
  switch (errorCode) {
    case 1:
      return "Reconnect using Chrome on Android; the raw PCM stream requires negotiated MTU ≥ 91.";
    case 2:
      return "Disconnect and reconnect so the PWA can enable audio notifications before START.";
    case 3:
      return "The current firmware audio source could not supply a frame.";
    case 4:
      return "Flash the matching firmware and reload this PWA without an old service-worker cache.";
    default:
      return "Check the serial log and reconnect.";
  }
}

async function startCapture() {
  try {
    resetCapture();
    setMessage("Starting stream…");
    await writeControl(COMMAND.start);
    log("START sent after notification subscription");
  } catch (error) {
    log(`START failed: ${error.message}`);
    setMessage(`Could not start: ${error.message}`, "error");
  }
}

async function stopCapture() {
  try {
    await writeControl(COMMAND.stop);
    captureActive = false;
    setConnectionState(true);
    expirePendingFrames(true);
    setMessage("Recording stopped. Play or download the captured WAV.", "success");
    log("STOP sent");
  } catch (error) {
    log(`STOP failed: ${error.message}`);
    setMessage(`Could not stop cleanly: ${error.message}`, "error");
  }
  updateStats(true);
}

function handleAudioNotification(event) {
  const packetSize = event.target.value.byteLength;
  stats.notifications += 1;
  stats.receivedBytes += packetSize;
  stats.minPacketSize = stats.minPacketSize === null
    ? packetSize
    : Math.min(stats.minPacketSize, packetSize);
  stats.maxPacketSize = Math.max(stats.maxPacketSize, packetSize);

  try {
    const packet = parseAudioPacket(event.target.value);
    acceptAudioPacket(packet);
  } catch (error) {
    stats.invalidPackets += 1;
    if (stats.invalidPackets <= 5 || stats.invalidPackets % 100 === 0) {
      log(`Invalid audio packet (${packetSize} B): ${error.message}`);
    }
  }

  expirePendingFrames(false);
  updateStats(false);
}

function acceptAudioPacket(packet) {
  let frame = pendingFrames.get(packet.sequence);
  if (!frame) {
    // A sequence gap here means an entire frame produced no valid packet.
    // A frame with any received chunk is instead counted as incomplete later.
    if (lastObservedFrameSequence !== null) {
      const distance = forwardSequenceDistance(
        lastObservedFrameSequence,
        packet.sequence
      );
      if (distance > 1 && distance < 0x8000) {
        stats.sequenceGaps += distance - 1;
      }
    }
    lastObservedFrameSequence = packet.sequence;

    frame = {
      totalChunks: packet.totalChunks,
      chunks: new Array(packet.totalChunks),
      receivedChunks: 0,
      byteLength: 0,
      createdAt: performance.now(),
    };
    pendingFrames.set(packet.sequence, frame);
  }

  if (frame.totalChunks !== packet.totalChunks) {
    pendingFrames.delete(packet.sequence);
    stats.invalidPackets += 1;
    log(`Frame ${packet.sequence} changed chunk count mid-frame`);
    return;
  }

  if (frame.chunks[packet.chunkIndex]) {
    stats.duplicatePackets += 1;
    return;
  }

  frame.chunks[packet.chunkIndex] = packet.payload;
  frame.receivedChunks += 1;
  frame.byteLength += packet.payloadLength;

  if (frame.receivedChunks !== frame.totalChunks) return;
  pendingFrames.delete(packet.sequence);

  if (frame.byteLength !== EXPECTED_FRAME_BYTES) {
    stats.invalidPackets += 1;
    log(`Frame ${packet.sequence} has ${frame.byteLength} PCM bytes; expected ${EXPECTED_FRAME_BYTES}`);
    return;
  }

  const completedFrame = combineBlocks(frame.chunks, frame.byteLength);
  pcmBlocks.push(completedFrame);
  pcmByteLength += completedFrame.byteLength;
  stats.completeFrames += 1;
  updateLevel(completedFrame);

  if (pcmByteLength >= CAPTURE_WARNING_BYTES && !memoryWarningShown) {
    memoryWarningShown = true;
    log("Capture exceeds 60 MB; download and start a new recording soon");
  }
}

function expirePendingFrames(force) {
  const now = performance.now();
  for (const [sequence, frame] of pendingFrames) {
    if (force || now - frame.createdAt > FRAME_TIMEOUT_MS) {
      pendingFrames.delete(sequence);
      stats.incompleteFrames += 1;
      if (stats.incompleteFrames <= 5) {
        log(
          `Dropped incomplete frame ${sequence}: ` +
          `${frame.receivedChunks}/${frame.totalChunks} chunks`
        );
      }
    }
  }
}

function updateLevel(pcm) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let energy = 0;
  const samples = pcm.byteLength / 2;
  for (let offset = 0; offset < pcm.byteLength; offset += 2) {
    const normalized = view.getInt16(offset, true) / 32768;
    energy += normalized * normalized;
  }
  const rms = Math.sqrt(energy / samples);
  const percent = Math.min(100, Math.max(1, rms * 300));
  ui.level.style.width = `${percent}%`;
  drawWaveform(pcm);
}

function prepareWaveformCanvas() {
  const rect = ui.waveform.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const targetWidth = Math.round(width * pixelRatio);
  const targetHeight = Math.round(height * pixelRatio);

  if (
    ui.waveform.width !== targetWidth ||
    ui.waveform.height !== targetHeight
  ) {
    ui.waveform.width = targetWidth;
    ui.waveform.height = targetHeight;
  }

  const context = ui.waveform.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { context, width, height };
}

function renderWaveform(pcm) {
  const { context, width, height } = prepareWaveformCanvas();
  context.clearRect(0, 0, width, height);

  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const sampleCount = pcm.byteLength / 2;
  const points = Math.min(180, Math.max(80, Math.floor(width / 4)));
  const center = height / 2;
  const amplitude = height * 0.39;

  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(34, 211, 238, 0.18)");
  gradient.addColorStop(0.3, "#67e8f9");
  gradient.addColorStop(0.58, "#a78bfa");
  gradient.addColorStop(0.82, "#c084fc");
  gradient.addColorStop(1, "rgba(251, 113, 133, 0.2)");

  context.beginPath();
  for (let point = 0; point < points; point += 1) {
    const sampleIndex = Math.min(
      sampleCount - 1,
      Math.floor((point / (points - 1)) * sampleCount)
    );
    const sample = view.getInt16(sampleIndex * 2, true) / 32768;
    const x = (point / (points - 1)) * width;
    const edgeFade = Math.sin((point / (points - 1)) * Math.PI) ** 0.22;
    const y = center - sample * amplitude * edgeFade;
    if (point === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }

  context.strokeStyle = gradient;
  context.lineWidth = 2.1;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowBlur = 16;
  context.shadowColor = "rgba(139, 92, 246, 0.65)";
  context.stroke();
  context.shadowBlur = 0;

  context.beginPath();
  context.moveTo(0, center);
  context.lineTo(width, center);
  context.strokeStyle = "rgba(255, 255, 255, 0.055)";
  context.lineWidth = 1;
  context.stroke();
}

function drawWaveform(pcm) {
  pendingWaveformPcm = pcm;
  if (waveformAnimationFrame) return;
  waveformAnimationFrame = requestAnimationFrame(() => {
    waveformAnimationFrame = 0;
    if (pendingWaveformPcm) renderWaveform(pendingWaveformPcm);
    pendingWaveformPcm = null;
  });
}

function drawIdleWaveform() {
  const samples = 180;
  const pcm = new Uint8Array(samples * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.sin((index / (samples - 1)) * Math.PI);
    const value = Math.sin(index * 0.22) * 420 * envelope;
    view.setInt16(index * 2, value, true);
  }
  renderWaveform(pcm);
}

function currentWavBlob() {
  if (pcmByteLength === 0) throw new Error("No complete audio frames captured");
  return buildWavBlob(pcmBlocks, pcmByteLength, EXPECTED_SAMPLE_RATE);
}

function playCapture() {
  try {
    releasePlayerUrl();
    playerObjectUrl = URL.createObjectURL(currentWavBlob());
    ui.player.src = playerObjectUrl;
    ui.player.play();
  } catch (error) {
    setMessage(`Cannot play capture: ${error.message}`, "error");
  }
}

function downloadCapture() {
  try {
    const url = URL.createObjectURL(currentWavBlob());
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `dk-pendant-${stamp}.wav`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log(`Downloaded WAV (${formatBytes(pcmByteLength)} PCM)`);
  } catch (error) {
    setMessage(`Cannot download capture: ${error.message}`, "error");
  }
}

ui.connect.addEventListener("click", connectPendant);
ui.disconnect.addEventListener("click", () => disconnectPendant(true));
ui.start.addEventListener("click", startCapture);
ui.stop.addEventListener("click", stopCapture);
ui.play.addEventListener("click", playCapture);
ui.download.addEventListener("click", downloadCapture);
ui.clear.addEventListener("click", () => {
  resetCapture();
  setMessage("Captured audio cleared.");
});

window.addEventListener("beforeunload", () => releasePlayerUrl());
window.addEventListener("resize", () => drawIdleWaveform());
setInterval(() => expirePendingFrames(false), 250);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      log(`Service worker registration failed: ${error.message}`);
    });
  });
}

updateButtons();
updateStats(true);
drawIdleWaveform();
if (!window.isSecureContext) {
  setMessage("Open this PWA through HTTPS or localhost; Web Bluetooth requires a secure context.", "error");
}
