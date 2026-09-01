(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Shared BLE Protocol v2
  // -------------------------------------------------------------------------

  const APP_VERSION = "3.0.0";
  const PROTOCOL_VERSION = 0x02;

  const SERVICE_UUID =
    "4fa12345-0000-1000-8000-00805f9b34fb";
  const AUDIO_CHAR_UUID =
    "4fa12346-0000-1000-8000-00805f9b34fb";
  const CONTROL_CHAR_UUID =
    "4fa12347-0000-1000-8000-00805f9b34fb";

  const CMD_STOP = 0x00;
  const CMD_START = 0x01;
  const CMD_GET_STATUS = 0x02;

  const AUDIO_MAGIC = 0xA5;
  const STATUS_MAGIC = 0x5A;
  const AUDIO_HEADER_BYTES = 8;
  const PCM_BYTES_PER_FRAME = 1600;
  const DEFAULT_SAMPLE_RATE = 16000;
  const MIN_CHUNKS_PER_FRAME = 10;
  const MAX_CHUNKS_PER_FRAME = 20;

  const DEVICE_STATE = {
    DISCONNECTED: 0,
    CONNECTED_IDLE: 1,
    STREAMING: 2,
    ERROR: 3
  };

  const ERROR_TEXT = {
    0: "No error",
    1: "BLE MTU is too small. Reconnect using Android Chrome.",
    2: "Audio notifications were not enabled before Start.",
    3: "The ESP audio source failed.",
    4: "PWA and ESP protocol versions do not match.",
    5: "The ESP received an invalid command.",
    6: "BLE transport changed. Stop and start again."
  };

  const MAX_RECORDING_MS = 30 * 60 * 1000;
  const START_TIMEOUT_MS = 5000;
  const INCOMPLETE_FRAME_TIMEOUT_MS = 900;

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------

  const ui = {
    connectionBadge: document.getElementById("connectionBadge"),
    connectionText: document.getElementById("connectionText"),
    connectButton: document.getElementById("connectButton"),
    startButton: document.getElementById("startButton"),
    stopButton: document.getElementById("stopButton"),
    recorderTitle: document.getElementById("recorderTitle"),
    recorderSubtitle: document.getElementById("recorderSubtitle"),
    waveformCanvas: document.getElementById("waveformCanvas"),
    timer: document.getElementById("timer"),
    levelText: document.getElementById("levelText"),
    signalMetric: document.getElementById("signalMetric"),
    signalDetail: document.getElementById("signalDetail"),
    framesMetric: document.getElementById("framesMetric"),
    framesDetail: document.getElementById("framesDetail"),
    transportMetric: document.getElementById("transportMetric"),
    transportDetail: document.getElementById("transportDetail"),
    qualityMetric: document.getElementById("qualityMetric"),
    qualityDetail: document.getElementById("qualityDetail"),
    recordingsList: document.getElementById("recordingsList"),
    emptyRecordings: document.getElementById("emptyRecordings"),
    clearRecordingsButton:
      document.getElementById("clearRecordingsButton"),
    diagnosticsLog: document.getElementById("diagnosticsLog"),
    copyDiagnosticsButton:
      document.getElementById("copyDiagnosticsButton"),
    clearDiagnosticsButton:
      document.getElementById("clearDiagnosticsButton"),
    toastRegion: document.getElementById("toastRegion"),
    settingsButton: document.getElementById("settingsButton"),
    settingsDialog: document.getElementById("settingsDialog"),
    settingsForm: document.getElementById("settingsForm"),
    closeSettingsButton:
      document.getElementById("closeSettingsButton"),
    endpointInput: document.getElementById("endpointInput"),
    tokenInput: document.getElementById("tokenInput"),
    wakeLockInput: document.getElementById("wakeLockInput"),
    installButton: document.getElementById("installButton"),
    appVersion: document.getElementById("appVersion")
  };

  // -------------------------------------------------------------------------
  // Runtime state
  // -------------------------------------------------------------------------

  let appState = "disconnected";
  let bluetoothDevice = null;
  let gattServer = null;
  let audioCharacteristic = null;
  let controlCharacteristic = null;
  let manualDisconnect = false;
  let connectInProgress = false;

  let deviceStatus = {
    state: DEVICE_STATE.DISCONNECTED,
    error: 0,
    mtu: 0,
    attCapacity: 0,
    chunksPerFrame: 0,
    headerBytes: AUDIO_HEADER_BYTES,
    sampleRate: DEFAULT_SAMPLE_RATE,
    samplesPerFrame: 800,
    payloadBytes: 0
  };

  let recordingConfirmed = false;
  let recordingStartedAt = 0;
  let timerInterval = null;
  let startTimeout = null;
  let stopFallbackTimeout = null;
  let finalizing = false;
  let wakeLock = null;

  let pendingFrames = new Map();
  let completedPcmFrames = [];
  let lastObservedSequence = null;
  let lastFrameCleanupAt = 0;

  let sessionStats = createEmptyStats();
  let levelHistory = [];
  let currentRms = 0;
  let lastDb = -96;
  let waveformPhase = 0;

  let diagnosticLines = [];
  let installPrompt = null;
  let renderedObjectUrls = [];
  let databasePromise = null;

  let settings = {
    endpoint: "",
    token: "",
    wakeLock: true
  };

  function createEmptyStats() {
    return {
      packetsReceived: 0,
      invalidPackets: 0,
      duplicatePackets: 0,
      completeFrames: 0,
      incompleteFrames: 0,
      missingFrames: 0,
      pcmBytes: 0,
      firstSequence: null,
      lastSequence: null
    };
  }

  // -------------------------------------------------------------------------
  // Logging and feedback
  // -------------------------------------------------------------------------

  function log(message, detail) {
    const time = new Date().toISOString();
    let line = "[" + time + "] " + message;

    if (detail !== undefined) {
      try {
        line += " " +
          (typeof detail === "string"
            ? detail
            : JSON.stringify(detail));
      } catch (error) {
        line += " [unserializable detail]";
      }
    }

    diagnosticLines.push(line);

    if (diagnosticLines.length > 300) {
      diagnosticLines = diagnosticLines.slice(-300);
    }

    ui.diagnosticsLog.textContent = diagnosticLines.join("\n");
    ui.diagnosticsLog.scrollTop = ui.diagnosticsLog.scrollHeight;
    console.log(line);
  }

  function toast(message, type) {
    const element = document.createElement("div");
    element.className =
      "toast" + (type === "error" ? " toast-error" : "");
    element.textContent = message;
    ui.toastRegion.appendChild(element);

    window.setTimeout(function () {
      element.remove();
    }, 3600);
  }

  function friendlyError(error) {
    if (!error) return "Unknown error";

    const name = error.name || "";
    const message = error.message || String(error);

    if (name === "NotFoundError") {
      return "No pendant was selected.";
    }

    if (name === "SecurityError") {
      return "Web Bluetooth requires HTTPS and browser permission.";
    }

    if (name === "NetworkError") {
      return "The Bluetooth connection was interrupted.";
    }

    if (name === "NotSupportedError") {
      return "This browser does not support the required Bluetooth feature.";
    }

    return message;
  }

  // -------------------------------------------------------------------------
  // Application state and UI
  // -------------------------------------------------------------------------

  function setAppState(nextState, message) {
    appState = nextState;

    ui.connectionBadge.className = "status-badge";
    ui.connectButton.disabled = false;
    ui.startButton.disabled = true;
    ui.stopButton.disabled = true;

    if (nextState === "unsupported") {
      ui.connectionBadge.classList.add("status-error");
      ui.connectionText.textContent = "Bluetooth unavailable";
      ui.connectButton.textContent = "Not supported";
      ui.connectButton.disabled = true;
      ui.recorderTitle.textContent = "Browser not supported.";
      ui.recorderSubtitle.textContent =
        message ||
        "Open this app in Android Chrome over HTTPS.";
      ui.levelText.textContent = "Web Bluetooth unavailable";
      return;
    }

    if (nextState === "disconnected") {
      ui.connectionBadge.classList.add("status-offline");
      ui.connectionText.textContent = "Not connected";
      ui.connectButton.textContent =
        bluetoothDevice ? "Reconnect" : "Connect pendant";
      ui.recorderTitle.textContent = "Ready when you are.";
      ui.recorderSubtitle.textContent =
        message ||
        "Connect your pendant to capture private, local audio.";
      ui.levelText.textContent = "Waiting for pendant";
      return;
    }

    if (nextState === "connecting") {
      ui.connectionBadge.classList.add("status-offline");
      ui.connectionText.textContent = "Connecting";
      ui.connectButton.textContent = "Connecting…";
      ui.connectButton.disabled = true;
      ui.recorderTitle.textContent = "Finding your pendant…";
      ui.recorderSubtitle.textContent =
        "Keep the pendant powered on and close to this phone.";
      ui.levelText.textContent = "Opening secure BLE connection";
      return;
    }

    if (nextState === "idle") {
      ui.connectionBadge.classList.add("status-ready");
      ui.connectionText.textContent = "Connected";
      ui.connectButton.textContent = "Disconnect";
      ui.startButton.disabled = deviceStatus.error !== 0;
      ui.recorderTitle.textContent = "Ready to capture.";
      ui.recorderSubtitle.textContent =
        message ||
        "Your pendant is connected. Start when the conversation begins.";
      ui.levelText.textContent = "Pendant ready";
      return;
    }

    if (nextState === "starting") {
      ui.connectionBadge.classList.add("status-ready");
      ui.connectionText.textContent = "Starting";
      ui.connectButton.textContent = "Disconnect";
      ui.connectButton.disabled = true;
      ui.stopButton.disabled = false;
      ui.recorderTitle.textContent = "Starting stream…";
      ui.recorderSubtitle.textContent =
        "Negotiating audio transport with the pendant.";
      ui.levelText.textContent = "Waiting for first audio frame";
      return;
    }

    if (nextState === "recording") {
      ui.connectionBadge.classList.add("status-recording");
      ui.connectionText.textContent = "Recording";
      ui.connectButton.textContent = "Disconnect";
      ui.connectButton.disabled = true;
      ui.stopButton.disabled = false;
      ui.recorderTitle.textContent = "Capturing the moment.";
      ui.recorderSubtitle.textContent =
        "Audio is arriving securely over Bluetooth.";
      ui.levelText.textContent = "Live PCM audio";
      return;
    }

    if (nextState === "stopping") {
      ui.connectionBadge.classList.add("status-ready");
      ui.connectionText.textContent = "Finishing";
      ui.connectButton.textContent = "Disconnect";
      ui.connectButton.disabled = true;
      ui.recorderTitle.textContent = "Finishing recording…";
      ui.recorderSubtitle.textContent =
        "Completing the last frame and creating the WAV file.";
      ui.levelText.textContent = "Finalising locally";
      return;
    }

    if (nextState === "error") {
      ui.connectionBadge.classList.add("status-error");
      ui.connectionText.textContent = "Needs attention";
      ui.connectButton.textContent =
        isGattConnected() ? "Disconnect" : "Reconnect";
      ui.recorderTitle.textContent = "Pendant needs attention.";
      ui.recorderSubtitle.textContent =
        message || "Check Diagnostics for details.";
      ui.levelText.textContent = message || "Transport error";
    }
  }

  function updateMetrics() {
    ui.framesMetric.textContent =
      String(sessionStats.completeFrames);
    ui.framesDetail.textContent =
      sessionStats.incompleteFrames +
      " incomplete · " +
      sessionStats.missingFrames +
      " missing";

    if (deviceStatus.mtu) {
      ui.transportMetric.textContent =
        String(deviceStatus.mtu);
      ui.transportDetail.textContent =
        "MTU · " +
        deviceStatus.chunksPerFrame +
        " chunks/frame";
    } else {
      ui.transportMetric.textContent = "—";
      ui.transportDetail.textContent = "MTU / chunks";
    }

    if (sessionStats.completeFrames > 0) {
      ui.signalMetric.textContent =
        Math.round(lastDb) + " dB";
      ui.signalDetail.textContent =
        Math.round(currentRms * 100) + "% RMS";

      const totalIssues =
        sessionStats.incompleteFrames +
        sessionStats.missingFrames +
        sessionStats.invalidPackets;
      const denominator =
        sessionStats.completeFrames + totalIssues;
      const issueRate =
        denominator > 0 ? totalIssues / denominator : 0;

      if (issueRate === 0) {
        ui.qualityMetric.textContent = "Excellent";
      } else if (issueRate < 0.01) {
        ui.qualityMetric.textContent = "Good";
      } else if (issueRate < 0.05) {
        ui.qualityMetric.textContent = "Fair";
      } else {
        ui.qualityMetric.textContent = "Poor";
      }

      ui.qualityDetail.textContent =
        (issueRate * 100).toFixed(1) + "% issue rate";
    } else {
      ui.signalMetric.textContent = "—";
      ui.signalDetail.textContent = "No stream";
      ui.qualityMetric.textContent = "—";
      ui.qualityDetail.textContent = "Waiting";
    }
  }

  // -------------------------------------------------------------------------
  // BLE connection
  // -------------------------------------------------------------------------

  function isGattConnected() {
    return Boolean(
      bluetoothDevice &&
      bluetoothDevice.gatt &&
      bluetoothDevice.gatt.connected
    );
  }

  async function connectPendant() {
    if (connectInProgress) return;

    if (!navigator.bluetooth) {
      setAppState(
        "unsupported",
        "Use Android Chrome over HTTPS. iPhone Web Bluetooth is not available."
      );
      return;
    }

    connectInProgress = true;
    manualDisconnect = false;
    setAppState("connecting");

    try {
      if (!bluetoothDevice) {
        bluetoothDevice = await navigator.bluetooth.requestDevice({
          filters: [
            { services: [SERVICE_UUID] }
          ],
          optionalServices: [SERVICE_UUID]
        });

        bluetoothDevice.addEventListener(
          "gattserverdisconnected",
          handleGattDisconnected
        );

        log("BLE device selected", {
          name: bluetoothDevice.name || "unnamed",
          id: bluetoothDevice.id
        });
      }

      gattServer = await bluetoothDevice.gatt.connect();
      log("GATT connected");

      const service =
        await gattServer.getPrimaryService(SERVICE_UUID);
      log("Pendant service resolved");

      audioCharacteristic =
        await service.getCharacteristic(AUDIO_CHAR_UUID);
      controlCharacteristic =
        await service.getCharacteristic(CONTROL_CHAR_UUID);
      log("Audio and control characteristics resolved");

      audioCharacteristic.addEventListener(
        "characteristicvaluechanged",
        handleAudioNotification
      );
      controlCharacteristic.addEventListener(
        "characteristicvaluechanged",
        handleStatusNotification
      );

      await controlCharacteristic.startNotifications();
      log("Control notifications enabled");

      await audioCharacteristic.startNotifications();
      log("Audio notifications enabled");

      // Let the CCCD subscription reach the peripheral before START is possible.
      await delay(180);
      await writeCommand(CMD_GET_STATUS);
      await delay(120);
      await readControlStatus();

      if (
        deviceStatus.state === DEVICE_STATE.CONNECTED_IDLE &&
        deviceStatus.error === 0
      ) {
        setAppState("idle");
        toast("Pendant connected");
      } else if (deviceStatus.state !== DEVICE_STATE.ERROR) {
        setAppState("idle", "Pendant connected and awaiting status.");
      }
    } catch (error) {
      const message = friendlyError(error);
      log("Connection failed", message);
      cleanupCharacteristics();
      setAppState("disconnected", message);

      if (error && error.name !== "NotFoundError") {
        toast(message, "error");
      }
    } finally {
      connectInProgress = false;
    }
  }

  async function disconnectPendant() {
    manualDisconnect = true;

    if (
      appState === "recording" ||
      appState === "starting" ||
      appState === "stopping"
    ) {
      await stopRecording();
      await delay(250);
    }

    if (isGattConnected()) {
      bluetoothDevice.gatt.disconnect();
    } else {
      cleanupCharacteristics();
      setAppState("disconnected");
    }
  }

  async function handleGattDisconnected() {
    log("GATT disconnected", {
      manual: manualDisconnect
    });

    const hadRecording =
      recordingConfirmed ||
      completedPcmFrames.length > 0;

    cleanupCharacteristics();

    if (hadRecording) {
      await finalizeRecording("connection-lost");
    }

    setAppState(
      "disconnected",
      manualDisconnect
        ? "Pendant disconnected."
        : "Connection was lost. Tap Reconnect to continue."
    );

    if (!manualDisconnect) {
      toast("Pendant connection lost", "error");
    }
  }

  function cleanupCharacteristics() {
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

    audioCharacteristic = null;
    controlCharacteristic = null;
    gattServer = null;

    deviceStatus = {
      state: DEVICE_STATE.DISCONNECTED,
      error: 0,
      mtu: 0,
      attCapacity: 0,
      chunksPerFrame: 0,
      headerBytes: AUDIO_HEADER_BYTES,
      sampleRate: DEFAULT_SAMPLE_RATE,
      samplesPerFrame: 800,
      payloadBytes: 0
    };

    stopTimer();
    releaseWakeLock();
  }

  async function writeCommand(command) {
    if (!controlCharacteristic || !isGattConnected()) {
      throw new Error("Pendant control characteristic is unavailable.");
    }

    const value = new Uint8Array([
      command,
      PROTOCOL_VERSION
    ]);

    const properties = controlCharacteristic.properties;

    if (
      properties.write &&
      typeof controlCharacteristic.writeValueWithResponse === "function"
    ) {
      await controlCharacteristic.writeValueWithResponse(value);
    } else if (
      properties.writeWithoutResponse &&
      typeof controlCharacteristic.writeValueWithoutResponse === "function"
    ) {
      await controlCharacteristic.writeValueWithoutResponse(value);
    } else {
      await controlCharacteristic.writeValue(value);
    }

    log("Control command sent", {
      command: command,
      protocol: PROTOCOL_VERSION
    });
  }

  async function readControlStatus() {
    if (!controlCharacteristic || !isGattConnected()) {
      return false;
    }

    try {
      const value = await controlCharacteristic.readValue();
      return parseStatusValue(value, "read");
    } catch (error) {
      log("Control status read failed", friendlyError(error));
      return false;
    }
  }

  function handleStatusNotification(event) {
    parseStatusValue(event.target.value, "notification");
  }

  function parseStatusValue(value, source) {
    if (!value || value.byteLength < 16) {
      log("Ignored short status value", {
        source: source,
        length: value ? value.byteLength : 0
      });
      return false;
    }

    if (value.getUint8(0) !== STATUS_MAGIC) {
      log("Ignored non-status control value", {
        source: source,
        firstByte: value.getUint8(0)
      });
      return false;
    }

    const version = value.getUint8(1);

    if (version !== PROTOCOL_VERSION) {
      const message =
        "Protocol mismatch: PWA " +
        PROTOCOL_VERSION +
        ", pendant " +
        version;
      log(message);
      setAppState("error", message);
      return false;
    }

    deviceStatus = {
      state: value.getUint8(2),
      error: value.getUint8(3),
      mtu: value.getUint16(4, true),
      attCapacity: value.getUint16(6, true),
      chunksPerFrame: value.getUint8(8),
      headerBytes: value.getUint8(9),
      sampleRate: value.getUint16(10, true),
      samplesPerFrame: value.getUint16(12, true),
      payloadBytes: value.getUint16(14, true)
    };

    log("Pendant status received", {
      source: source,
      state: deviceStatus.state,
      error: deviceStatus.error,
      mtu: deviceStatus.mtu,
      attCapacity: deviceStatus.attCapacity,
      chunks: deviceStatus.chunksPerFrame,
      payload: deviceStatus.payloadBytes,
      sampleRate: deviceStatus.sampleRate
    });

    updateMetrics();

    if (
      deviceStatus.state === DEVICE_STATE.ERROR ||
      deviceStatus.error !== 0
    ) {
      const message =
        ERROR_TEXT[deviceStatus.error] ||
        "Unknown pendant error " + deviceStatus.error;

      clearStartTimeout();
      log("Pendant reported error", message);
      setAppState("error", message);
      toast(message, "error");
      return true;
    }

    if (deviceStatus.state === DEVICE_STATE.STREAMING) {
      confirmRecordingStarted("status");
      return true;
    }

    if (deviceStatus.state === DEVICE_STATE.CONNECTED_IDLE) {
      if (appState === "stopping") {
        scheduleFinalize(140, "normal");
      } else if (
        appState !== "recording" &&
        appState !== "starting"
      ) {
        setAppState("idle");
      }
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Recording lifecycle
  // -------------------------------------------------------------------------

  async function startRecording() {
    if (appState !== "idle" || finalizing) return;

    resetCollector();
    setAppState("starting");

    try {
      if (settings.wakeLock) {
        await acquireWakeLock();
      }

      // Reassert both subscriptions after reconnect/browser suspension.
      await controlCharacteristic.startNotifications();
      await audioCharacteristic.startNotifications();
      await delay(180);

      await writeCommand(CMD_START);

      startTimeout = window.setTimeout(async function () {
        if (appState !== "starting") return;

        await readControlStatus();

        if (appState === "starting") {
          const message =
            "The pendant did not acknowledge Start within five seconds.";
          log(message);
          setAppState("error", message);
          toast(message, "error");
          releaseWakeLock();
        }
      }, START_TIMEOUT_MS);

      // Read-back covers browsers that miss the control notification.
      await delay(180);
      await readControlStatus();
    } catch (error) {
      const message = friendlyError(error);
      log("Start failed", message);
      clearStartTimeout();
      releaseWakeLock();
      setAppState("error", message);
      toast(message, "error");
    }
  }

  function confirmRecordingStarted(source) {
    if (
      appState !== "starting" &&
      appState !== "recording"
    ) {
      return;
    }

    if (!recordingConfirmed) {
      recordingConfirmed = true;
      recordingStartedAt = performance.now();
      clearStartTimeout();
      startTimer();
      setAppState("recording");
      log("Recording confirmed", { source: source });
      toast("Recording started");
    }
  }

  async function stopRecording() {
    if (
      appState !== "recording" &&
      appState !== "starting"
    ) {
      return;
    }

    setAppState("stopping");
    clearStartTimeout();

    try {
      await writeCommand(CMD_STOP);
      log("Stop command accepted by browser");

      await delay(160);
      await readControlStatus();

      if (appState === "stopping") {
        stopFallbackTimeout = window.setTimeout(function () {
          scheduleFinalize(0, "stop-timeout");
        }, 650);
      }
    } catch (error) {
      log("Stop command failed", friendlyError(error));
      scheduleFinalize(0, "stop-write-failed");
    }
  }

  function scheduleFinalize(delayMs, reason) {
    if (stopFallbackTimeout) {
      clearTimeout(stopFallbackTimeout);
      stopFallbackTimeout = null;
    }

    window.setTimeout(function () {
      finalizeRecording(reason);
    }, delayMs);
  }

  async function finalizeRecording(reason) {
    if (finalizing) return;

    finalizing = true;
    clearStartTimeout();
    stopTimer();
    cleanupStaleFrames(true);

    try {
      if (completedPcmFrames.length === 0) {
        log("Recording ended without complete PCM frames", {
          reason: reason,
          packets: sessionStats.packetsReceived,
          invalid: sessionStats.invalidPackets
        });

        toast(
          "No complete audio was received. Check Diagnostics.",
          "error"
        );
        resetCollector();

        if (isGattConnected()) {
          setAppState("idle");
        }
        return;
      }

      const sampleRate =
        deviceStatus.sampleRate || DEFAULT_SAMPLE_RATE;
      const wavBlob =
        createWavBlob(completedPcmFrames, sampleRate);
      const durationMs =
        Math.round(
          (sessionStats.pcmBytes / 2 / sampleRate) * 1000
        );
      const now = new Date();
      const id =
        now.getTime().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 8);

      const recording = {
        id: id,
        name: defaultRecordingName(now),
        createdAt: now.toISOString(),
        durationMs: durationMs,
        sizeBytes: wavBlob.size,
        sampleRate: sampleRate,
        blob: wavBlob,
        notes: "",
        transcript: "",
        summary: "",
        stopReason: reason,
        stats: Object.assign({}, sessionStats)
      };

      await putRecording(recording);

      log("Recording saved", {
        id: id,
        durationMs: durationMs,
        sizeBytes: wavBlob.size,
        completeFrames: sessionStats.completeFrames,
        incompleteFrames: sessionStats.incompleteFrames,
        missingFrames: sessionStats.missingFrames,
        reason: reason
      });

      toast("Recording saved locally");
      resetCollector();
      await renderRecordings();

      if (isGattConnected()) {
        setAppState("idle");
      }
    } catch (error) {
      const message = friendlyError(error);
      log("Could not finalise recording", message);
      toast("Could not save recording: " + message, "error");

      if (isGattConnected()) {
        setAppState("error", message);
      }
    } finally {
      finalizing = false;
      releaseWakeLock();
    }
  }

  function resetCollector() {
    pendingFrames.clear();
    completedPcmFrames = [];
    lastObservedSequence = null;
    lastFrameCleanupAt = 0;
    sessionStats = createEmptyStats();
    recordingConfirmed = false;
    recordingStartedAt = 0;
    levelHistory = [];
    currentRms = 0;
    lastDb = -96;
    ui.timer.textContent = "00:00";
    updateMetrics();
  }

  function clearStartTimeout() {
    if (startTimeout) {
      clearTimeout(startTimeout);
      startTimeout = null;
    }
  }

  // -------------------------------------------------------------------------
  // Audio packet assembly
  // -------------------------------------------------------------------------

  function handleAudioNotification(event) {
    const value = event.target.value;

    if (!value || value.byteLength < AUDIO_HEADER_BYTES) {
      sessionStats.invalidPackets += 1;
      return;
    }

    if (
      value.getUint8(0) !== AUDIO_MAGIC ||
      value.getUint8(1) !== PROTOCOL_VERSION
    ) {
      sessionStats.invalidPackets += 1;
      log("Rejected audio packet with invalid marker/version", {
        marker: value.getUint8(0),
        version: value.getUint8(1),
        length: value.byteLength
      });
      updateMetrics();
      return;
    }

    if (appState === "starting") {
      confirmRecordingStarted("first-audio-packet");
    }

    if (
      appState !== "recording" &&
      appState !== "starting" &&
      appState !== "stopping"
    ) {
      return;
    }

    const sequence = value.getUint16(2, true);
    const chunkIndex = value.getUint8(4);
    const totalChunks = value.getUint8(5);
    const payloadLength = value.getUint16(6, true);

    sessionStats.packetsReceived += 1;

    if (
      totalChunks < MIN_CHUNKS_PER_FRAME ||
      totalChunks > MAX_CHUNKS_PER_FRAME ||
      chunkIndex >= totalChunks ||
      payloadLength === 0 ||
      AUDIO_HEADER_BYTES + payloadLength !== value.byteLength
    ) {
      sessionStats.invalidPackets += 1;
      log("Rejected malformed audio packet", {
        sequence: sequence,
        chunk: chunkIndex,
        total: totalChunks,
        payload: payloadLength,
        packetLength: value.byteLength
      });
      updateMetrics();
      return;
    }

    let frame = pendingFrames.get(sequence);

    if (!frame) {
      observeSequence(sequence);

      frame = {
        sequence: sequence,
        totalChunks: totalChunks,
        chunks: new Array(totalChunks),
        receivedChunks: 0,
        receivedBytes: 0,
        createdAt: performance.now()
      };

      pendingFrames.set(sequence, frame);
    }

    if (frame.totalChunks !== totalChunks) {
      pendingFrames.delete(sequence);
      sessionStats.invalidPackets += 1;
      log("Chunk count changed inside frame", {
        sequence: sequence
      });
      return;
    }

    if (frame.chunks[chunkIndex]) {
      sessionStats.duplicatePackets += 1;
      return;
    }

    const payload = new Uint8Array(payloadLength);
    payload.set(
      new Uint8Array(
        value.buffer,
        value.byteOffset + AUDIO_HEADER_BYTES,
        payloadLength
      )
    );

    frame.chunks[chunkIndex] = payload;
    frame.receivedChunks += 1;
    frame.receivedBytes += payloadLength;

    if (frame.receivedChunks === frame.totalChunks) {
      completeFrame(frame);
      pendingFrames.delete(sequence);
    }

    const now = performance.now();

    if (now - lastFrameCleanupAt > 250) {
      lastFrameCleanupAt = now;
      cleanupStaleFrames(false);
    }
  }

  function observeSequence(sequence) {
    if (sessionStats.firstSequence === null) {
      sessionStats.firstSequence = sequence;
    }

    if (lastObservedSequence !== null) {
      const delta =
        (sequence - lastObservedSequence + 65536) % 65536;

      if (delta > 1 && delta < 32768) {
        sessionStats.missingFrames += delta - 1;
      }
    }

    lastObservedSequence = sequence;
    sessionStats.lastSequence = sequence;
  }

  function completeFrame(frame) {
    if (frame.receivedBytes !== PCM_BYTES_PER_FRAME) {
      sessionStats.incompleteFrames += 1;
      log("Dropped frame with incorrect PCM length", {
        sequence: frame.sequence,
        bytes: frame.receivedBytes
      });
      updateMetrics();
      return;
    }

    const pcm = new Uint8Array(PCM_BYTES_PER_FRAME);
    let offset = 0;

    for (let index = 0; index < frame.totalChunks; index += 1) {
      const chunk = frame.chunks[index];

      if (!chunk) {
        sessionStats.incompleteFrames += 1;
        return;
      }

      pcm.set(chunk, offset);
      offset += chunk.length;
    }

    completedPcmFrames.push(pcm);
    sessionStats.completeFrames += 1;
    sessionStats.pcmBytes += pcm.length;

    updateAudioLevel(pcm);
    updateMetrics();

    const durationMs =
      (sessionStats.pcmBytes / 2 /
        (deviceStatus.sampleRate || DEFAULT_SAMPLE_RATE)) *
      1000;

    if (durationMs >= MAX_RECORDING_MS) {
      log("Maximum recording duration reached");
      toast("30-minute limit reached. Saving recording.");
      stopRecording();
    }
  }

  function cleanupStaleFrames(force) {
    const now = performance.now();

    pendingFrames.forEach(function (frame, sequence) {
      if (
        force ||
        now - frame.createdAt > INCOMPLETE_FRAME_TIMEOUT_MS
      ) {
        pendingFrames.delete(sequence);
        sessionStats.incompleteFrames += 1;
      }
    });

    updateMetrics();
  }

  function updateAudioLevel(pcm) {
    const view = new DataView(
      pcm.buffer,
      pcm.byteOffset,
      pcm.byteLength
    );
    let sumSquares = 0;
    const samples = pcm.byteLength / 2;

    for (let index = 0; index < samples; index += 1) {
      const normalized =
        view.getInt16(index * 2, true) / 32768;
      sumSquares += normalized * normalized;
    }

    currentRms = Math.sqrt(sumSquares / samples);
    lastDb =
      20 * Math.log10(Math.max(currentRms, 0.000016));
    levelHistory.push(currentRms);

    if (levelHistory.length > 150) {
      levelHistory.shift();
    }
  }

  // -------------------------------------------------------------------------
  // WAV creation
  // -------------------------------------------------------------------------

  function createWavBlob(pcmFrames, sampleRate) {
    const dataLength = pcmFrames.reduce(function (total, frame) {
      return total + frame.byteLength;
    }, 0);

    const header = new ArrayBuffer(44);
    const view = new DataView(header);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataLength, true);

    return new Blob(
      [header].concat(pcmFrames),
      { type: "audio/wav" }
    );
  }

  function writeAscii(view, offset, text) {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  }

  // -------------------------------------------------------------------------
  // Timer, wake lock and waveform
  // -------------------------------------------------------------------------

  function startTimer() {
    stopTimer();
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 200);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimer() {
    if (!recordingConfirmed || !recordingStartedAt) return;

    const elapsed = performance.now() - recordingStartedAt;
    ui.timer.textContent = formatClock(elapsed);
  }

  function formatClock(milliseconds) {
    const totalSeconds = Math.max(
      0,
      Math.floor(milliseconds / 1000)
    );
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return (
        pad2(hours) +
        ":" +
        pad2(minutes) +
        ":" +
        pad2(seconds)
      );
    }

    return pad2(minutes) + ":" + pad2(seconds);
  }

  function pad2(number) {
    return String(number).padStart(2, "0");
  }

  async function acquireWakeLock() {
    if (!("wakeLock" in navigator) || wakeLock) return;

    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", function () {
        wakeLock = null;
        log("Screen wake lock released");
      });
      log("Screen wake lock acquired");
    } catch (error) {
      log("Wake lock unavailable", friendlyError(error));
    }
  }

  async function releaseWakeLock() {
    if (!wakeLock) return;

    try {
      await wakeLock.release();
    } catch (error) {
      log("Wake lock release failed", friendlyError(error));
    } finally {
      wakeLock = null;
    }
  }

  function drawWaveform() {
    const canvas = ui.waveformCanvas;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);

    const centerY = height / 2;
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "rgba(25,211,197,.22)");
    gradient.addColorStop(.5, "rgba(202,255,250,.96)");
    gradient.addColorStop(1, "rgba(124,108,255,.28)");

    context.strokeStyle = "rgba(173,207,235,.08)";
    context.lineWidth = ratio;
    context.beginPath();
    context.moveTo(0, centerY);
    context.lineTo(width, centerY);
    context.stroke();

    const values =
      levelHistory.length > 2
        ? levelHistory
        : createIdleWaveValues(90);
    const barCount = Math.min(values.length, 120);
    const spacing = width / barCount;

    context.strokeStyle = gradient;
    context.lineWidth = Math.max(2 * ratio, spacing * .33);
    context.lineCap = "round";

    for (let index = 0; index < barCount; index += 1) {
      const sourceIndex =
        Math.floor(
          (index / Math.max(1, barCount - 1)) *
          (values.length - 1)
        );
      const value = values[sourceIndex];
      const boosted =
        levelHistory.length > 2
          ? Math.min(1, value * 4.8)
          : value;
      const amplitude =
        Math.max(3 * ratio, boosted * height * .39);
      const x = spacing * index + spacing / 2;

      context.beginPath();
      context.moveTo(x, centerY - amplitude);
      context.lineTo(x, centerY + amplitude);
      context.stroke();
    }

    waveformPhase += .018;
    requestAnimationFrame(drawWaveform);
  }

  function createIdleWaveValues(count) {
    const values = [];

    for (let index = 0; index < count; index += 1) {
      const position = index / count;
      const envelope = Math.sin(position * Math.PI);
      const value =
        .035 +
        Math.abs(
          Math.sin(index * .37 + waveformPhase)
        ) *
        .05 *
        envelope;
      values.push(value);
    }

    return values;
  }

  // -------------------------------------------------------------------------
  // IndexedDB recording storage
  // -------------------------------------------------------------------------

  function openDatabase() {
    if (databasePromise) return databasePromise;

    databasePromise = new Promise(function (resolve, reject) {
      const request =
        indexedDB.open("dk-pendant-recordings", 1);

      request.onupgradeneeded = function () {
        const database = request.result;

        if (!database.objectStoreNames.contains("recordings")) {
          const store = database.createObjectStore(
            "recordings",
            { keyPath: "id" }
          );
          store.createIndex("createdAt", "createdAt");
        }
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        reject(request.error);
      };
    });

    return databasePromise;
  }

  async function putRecording(recording) {
    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction =
        database.transaction("recordings", "readwrite");
      transaction.objectStore("recordings").put(recording);
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () {
        reject(transaction.error);
      };
    });
  }

  async function getAllRecordings() {
    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction =
        database.transaction("recordings", "readonly");
      const request =
        transaction.objectStore("recordings").getAll();
      request.onsuccess = function () {
        resolve(request.result || []);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function deleteRecording(id) {
    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction =
        database.transaction("recordings", "readwrite");
      transaction.objectStore("recordings").delete(id);
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () {
        reject(transaction.error);
      };
    });
  }

  async function clearAllRecordings() {
    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction =
        database.transaction("recordings", "readwrite");
      transaction.objectStore("recordings").clear();
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () {
        reject(transaction.error);
      };
    });
  }

  // -------------------------------------------------------------------------
  // Recording library UI
  // -------------------------------------------------------------------------

  async function renderRecordings() {
    renderedObjectUrls.forEach(function (url) {
      URL.revokeObjectURL(url);
    });
    renderedObjectUrls = [];
    ui.recordingsList.replaceChildren();

    let recordings = [];

    try {
      recordings = await getAllRecordings();
    } catch (error) {
      log("Could not load recordings", friendlyError(error));
      toast("Could not load local recordings", "error");
      return;
    }

    recordings.sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    ui.emptyRecordings.classList.toggle(
      "hidden",
      recordings.length > 0
    );
    ui.clearRecordingsButton.classList.toggle(
      "hidden",
      recordings.length === 0
    );

    recordings.forEach(function (recording) {
      ui.recordingsList.appendChild(
        createRecordingCard(recording)
      );
    });
  }

  function createRecordingCard(recording) {
    const card = document.createElement("article");
    card.className = "recording-card";

    const titleRow = document.createElement("div");
    titleRow.className = "recording-title-row";

    const title = document.createElement("input");
    title.className = "recording-title";
    title.value = recording.name;
    title.setAttribute("aria-label", "Recording name");
    title.addEventListener("change", async function () {
      recording.name =
        title.value.trim() || defaultRecordingName(new Date());
      title.value = recording.name;
      await putRecording(recording);
      log("Recording renamed", { id: recording.id });
    });
    titleRow.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "recording-meta";

    [
      formatDate(recording.createdAt),
      formatDuration(recording.durationMs),
      formatBytes(recording.sizeBytes),
      String(recording.sampleRate || DEFAULT_SAMPLE_RATE) + " Hz"
    ].forEach(function (text) {
      const item = document.createElement("span");
      item.textContent = text;
      meta.appendChild(item);
    });

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    const audioUrl = URL.createObjectURL(recording.blob);
    renderedObjectUrls.push(audioUrl);
    audio.src = audioUrl;

    const actions = document.createElement("div");
    actions.className = "recording-actions";

    actions.appendChild(
      makeActionButton("Download", function () {
        downloadRecording(recording);
      })
    );

    const transcribeButton =
      makeActionButton("Transcribe", function () {
        transcribeRecording(recording, transcribeButton);
      });
    actions.appendChild(transcribeButton);

    actions.appendChild(
      makeActionButton("Delete", async function () {
        if (!window.confirm("Delete this recording permanently?")) {
          return;
        }
        await deleteRecording(recording.id);
        log("Recording deleted", { id: recording.id });
        await renderRecordings();
      }, true)
    );

    const notes = document.createElement("textarea");
    notes.className = "recording-notes";
    notes.placeholder = "Add notes for this recording…";
    notes.value = recording.notes || "";
    notes.setAttribute("aria-label", "Recording notes");
    bindDebouncedSave(notes, async function () {
      recording.notes = notes.value;
      await putRecording(recording);
    });

    card.appendChild(titleRow);
    card.appendChild(meta);
    card.appendChild(audio);
    card.appendChild(actions);
    card.appendChild(notes);

    if (recording.transcript) {
      const transcript = document.createElement("textarea");
      transcript.className = "recording-transcript";
      transcript.value = recording.transcript;
      transcript.setAttribute("aria-label", "Transcript");
      bindDebouncedSave(transcript, async function () {
        recording.transcript = transcript.value;
        await putRecording(recording);
      });
      card.appendChild(transcript);
    }

    if (recording.summary) {
      const summary = document.createElement("p");
      summary.className = "recording-summary";
      summary.textContent = recording.summary;
      card.appendChild(summary);
    }

    return card;
  }

  function makeActionButton(label, handler, danger) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      danger
        ? "button button-danger button-small"
        : "button button-secondary button-small";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function bindDebouncedSave(element, saveFunction) {
    let timeout = null;

    element.addEventListener("input", function () {
      clearTimeout(timeout);
      timeout = window.setTimeout(function () {
        Promise.resolve(saveFunction()).catch(function (error) {
          log("Local edit save failed", friendlyError(error));
        });
      }, 500);
    });
  }

  function downloadRecording(recording) {
    const url = URL.createObjectURL(recording.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      sanitizeFilename(recording.name) + ".wav";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    log("Recording downloaded", { id: recording.id });
  }

  async function transcribeRecording(recording, button) {
    if (!settings.endpoint) {
      openSettings();
      toast("Add a transcription endpoint first.", "error");
      return;
    }

    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = "Transcribing…";

    try {
      const form = new FormData();
      form.append(
        "audio",
        recording.blob,
        sanitizeFilename(recording.name) + ".wav"
      );
      form.append("sample_rate", String(recording.sampleRate));
      form.append("recording_id", recording.id);

      const headers = {};

      if (settings.token) {
        headers.Authorization = "Bearer " + settings.token;
      }

      log("Sending recording for transcription", {
        id: recording.id,
        endpoint: settings.endpoint
      });

      const response = await fetch(settings.endpoint, {
        method: "POST",
        headers: headers,
        body: form
      });

      if (!response.ok) {
        throw new Error(
          "Transcription server returned HTTP " + response.status
        );
      }

      const contentType =
        response.headers.get("content-type") || "";
      let transcript = "";
      let summary = "";

      if (contentType.includes("application/json")) {
        const result = await response.json();
        transcript =
          result.transcript ||
          result.text ||
          (result.result && result.result.transcript) ||
          "";
        summary =
          result.summary ||
          (result.result && result.result.summary) ||
          "";
      } else {
        transcript = await response.text();
      }

      if (!transcript) {
        throw new Error(
          "The server response did not contain transcript or text."
        );
      }

      recording.transcript = String(transcript);
      recording.summary = summary ? String(summary) : "";
      await putRecording(recording);
      await renderRecordings();
      toast("Transcription complete");
      log("Transcription saved", { id: recording.id });
    } catch (error) {
      const message = friendlyError(error);
      log("Transcription failed", message);
      toast("Transcription failed: " + message, "error");
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  // -------------------------------------------------------------------------
  // Settings and PWA lifecycle
  // -------------------------------------------------------------------------

  function loadSettings() {
    try {
      const stored =
        JSON.parse(localStorage.getItem("dk-pendant-settings") || "{}");
      settings = {
        endpoint: stored.endpoint || "",
        token: stored.token || "",
        wakeLock: stored.wakeLock !== false
      };
    } catch (error) {
      log("Settings could not be parsed; defaults restored");
    }

    ui.endpointInput.value = settings.endpoint;
    ui.tokenInput.value = settings.token;
    ui.wakeLockInput.checked = settings.wakeLock;
  }

  function saveSettings() {
    settings = {
      endpoint: ui.endpointInput.value.trim(),
      token: ui.tokenInput.value.trim(),
      wakeLock: ui.wakeLockInput.checked
    };

    localStorage.setItem(
      "dk-pendant-settings",
      JSON.stringify(settings)
    );

    log("Settings saved", {
      endpointConfigured: Boolean(settings.endpoint),
      tokenConfigured: Boolean(settings.token),
      wakeLock: settings.wakeLock
    });
    toast("Settings saved");
  }

  function openSettings() {
    ui.endpointInput.value = settings.endpoint;
    ui.tokenInput.value = settings.token;
    ui.wakeLockInput.checked = settings.wakeLock;
    ui.settingsDialog.showModal();
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    try {
      const registration =
        await navigator.serviceWorker.register("./sw.js");
      log("Service worker registered", {
        scope: registration.scope
      });
    } catch (error) {
      log("Service worker registration failed", friendlyError(error));
    }
  }

  function setupInstallPrompt() {
    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      installPrompt = event;
      ui.installButton.classList.remove("hidden");
    });

    window.addEventListener("appinstalled", function () {
      installPrompt = null;
      ui.installButton.classList.add("hidden");
      toast("DK Pendant installed");
      log("PWA installed");
    });
  }

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------

  function defaultRecordingName(date) {
    return (
      "Recording " +
      date.toLocaleDateString([], {
        day: "2-digit",
        month: "short"
      }) +
      " " +
      date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })
    );
  }

  function formatDate(value) {
    return new Date(value).toLocaleString([], {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatDuration(milliseconds) {
    return formatClock(milliseconds || 0);
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";

    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1
    );

    return (
      (bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0) +
      " " +
      units[index]
    );
  }

  function sanitizeFilename(value) {
    const cleaned = String(value || "recording")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
      .replace(/\s+/g, " ")
      .trim();

    return cleaned.slice(0, 80) || "recording";
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------

  function bindEvents() {
    ui.connectButton.addEventListener("click", function () {
      if (isGattConnected()) {
        disconnectPendant();
      } else {
        connectPendant();
      }
    });

    ui.startButton.addEventListener("click", startRecording);
    ui.stopButton.addEventListener("click", stopRecording);
    ui.settingsButton.addEventListener("click", openSettings);

    ui.closeSettingsButton.addEventListener("click", function () {
      ui.settingsDialog.close();
    });

    ui.settingsForm.addEventListener("submit", function (event) {
      event.preventDefault();
      saveSettings();
      ui.settingsDialog.close();
    });

    ui.installButton.addEventListener("click", async function () {
      if (!installPrompt) return;
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      ui.installButton.classList.add("hidden");
    });

    ui.clearRecordingsButton.addEventListener(
      "click",
      async function () {
        if (
          !window.confirm(
            "Delete all locally stored recordings permanently?"
          )
        ) {
          return;
        }

        await clearAllRecordings();
        log("All local recordings deleted");
        await renderRecordings();
      }
    );

    ui.copyDiagnosticsButton.addEventListener(
      "click",
      async function () {
        const text = diagnosticLines.join("\n");

        try {
          await navigator.clipboard.writeText(text);
          toast("Diagnostics copied");
        } catch (error) {
          const area = document.createElement("textarea");
          area.value = text;
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
          toast("Diagnostics copied");
        }
      }
    );

    ui.clearDiagnosticsButton.addEventListener("click", function () {
      diagnosticLines = [];
      ui.diagnosticsLog.textContent = "";
      log("Diagnostics cleared");
    });

    document.addEventListener("visibilitychange", function () {
      if (
        document.visibilityState === "visible" &&
        recordingConfirmed &&
        settings.wakeLock
      ) {
        acquireWakeLock();
      }
    });

    window.addEventListener("beforeunload", function (event) {
      if (recordingConfirmed) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }

  // -------------------------------------------------------------------------
  // Start-up
  // -------------------------------------------------------------------------

  async function initialize() {
    ui.appVersion.textContent = "PWA " + APP_VERSION;
    loadSettings();
    bindEvents();
    setupInstallPrompt();
    drawWaveform();
    updateMetrics();

    log("Application started", {
      version: APP_VERSION,
      protocol: PROTOCOL_VERSION,
      secureContext: window.isSecureContext,
      webBluetooth: Boolean(navigator.bluetooth),
      userAgent: navigator.userAgent
    });

    if (!window.isSecureContext) {
      setAppState(
        "unsupported",
        "This page must be hosted over HTTPS for Web Bluetooth."
      );
    } else if (!navigator.bluetooth) {
      setAppState(
        "unsupported",
        "Use Android Chrome. Web Bluetooth is unavailable in this browser."
      );
    } else {
      setAppState("disconnected");
    }

    await renderRecordings();
    registerServiceWorker();
  }

  initialize().catch(function (error) {
    const message = friendlyError(error);
    log("Fatal initialization error", message);
    setAppState("error", message);
  });
})();
