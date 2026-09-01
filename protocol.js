export const PROTOCOL_VERSION = 2;

export const UUIDS = Object.freeze({
  service: "4fa12345-0000-1000-8000-00805f9b34fb",
  audio: "4fa12346-0000-1000-8000-00805f9b34fb",
  control: "4fa12347-0000-1000-8000-00805f9b34fb",
});

export const COMMAND = Object.freeze({
  stop: 0x00,
  start: 0x01,
  getStatus: 0x02,
});

export const DEVICE_STATE = Object.freeze({
  0: "Disconnected",
  1: "Connected · idle",
  2: "Streaming",
  3: "Transport error",
});

export const ERROR_TEXT = Object.freeze({
  0: "None",
  1: "Negotiated BLE MTU is too small",
  2: "Audio notifications are not subscribed",
  3: "Audio source failed",
  4: "Protocol version mismatch",
  5: "Unknown control command",
});

export const AUDIO_PACKET_MAGIC = 0xa5;
export const STATUS_PACKET_MAGIC = 0x5a;
export const AUDIO_HEADER_BYTES = 8;
export const EXPECTED_FRAME_BYTES = 1600;
export const EXPECTED_SAMPLE_RATE = 16000;
export const MIN_CHUNKS = 10;
export const MAX_CHUNKS = 20;

export function calculateFrameLayout(peerMtu) {
  const attValueCapacity = peerMtu - 3;
  const maximumPayload = Math.min(
    attValueCapacity - AUDIO_HEADER_BYTES,
    EXPECTED_FRAME_BYTES / MIN_CHUNKS
  );
  if (maximumPayload <= 0) {
    throw new Error(`MTU ${peerMtu} cannot carry the audio header`);
  }

  const chunksPerFrame = Math.max(
    MIN_CHUNKS,
    Math.ceil(EXPECTED_FRAME_BYTES / maximumPayload)
  );
  if (chunksPerFrame > MAX_CHUNKS) {
    throw new Error(`MTU ${peerMtu} needs ${chunksPerFrame} chunks per frame`);
  }

  const payloadBytes = Math.ceil(EXPECTED_FRAME_BYTES / chunksPerFrame);
  return { attValueCapacity, chunksPerFrame, payloadBytes };
}

function asDataView(value) {
  if (value instanceof DataView) return value;
  if (value instanceof ArrayBuffer) return new DataView(value);
  if (ArrayBuffer.isView(value)) {
    return new DataView(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Expected DataView, ArrayBuffer, or typed array");
}

export function parseAudioPacket(value) {
  const view = asDataView(value);
  if (view.byteLength < AUDIO_HEADER_BYTES) {
    throw new Error(`Audio packet is only ${view.byteLength} bytes`);
  }
  if (view.getUint8(0) !== AUDIO_PACKET_MAGIC) {
    throw new Error("Audio packet magic does not match");
  }
  if (view.getUint8(1) !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported audio protocol ${view.getUint8(1)}`);
  }

  const sequence = view.getUint16(2, true);
  const chunkIndex = view.getUint8(4);
  const totalChunks = view.getUint8(5);
  const payloadLength = view.getUint16(6, true);

  if (totalChunks < MIN_CHUNKS || totalChunks > MAX_CHUNKS) {
    throw new Error(`Invalid chunk count ${totalChunks}`);
  }
  if (chunkIndex >= totalChunks) {
    throw new Error(`Chunk ${chunkIndex} is outside ${totalChunks}`);
  }
  if (view.byteLength !== AUDIO_HEADER_BYTES + payloadLength) {
    throw new Error(
      `Packet length ${view.byteLength} does not match header ${payloadLength}`
    );
  }
  if (payloadLength === 0 || payloadLength % 2 !== 0) {
    throw new Error(`Invalid PCM16 payload length ${payloadLength}`);
  }

  const payload = new Uint8Array(payloadLength);
  payload.set(
    new Uint8Array(
      view.buffer,
      view.byteOffset + AUDIO_HEADER_BYTES,
      payloadLength
    )
  );

  return { sequence, chunkIndex, totalChunks, payloadLength, payload };
}

export function parseStatusPacket(value) {
  const view = asDataView(value);
  if (view.byteLength !== 16) {
    throw new Error(`Status packet must be 16 bytes, received ${view.byteLength}`);
  }
  if (view.getUint8(0) !== STATUS_PACKET_MAGIC) {
    throw new Error("Status packet magic does not match");
  }

  return {
    protocolVersion: view.getUint8(1),
    state: view.getUint8(2),
    error: view.getUint8(3),
    peerMtu: view.getUint16(4, true),
    attValueCapacity: view.getUint16(6, true),
    chunksPerFrame: view.getUint8(8),
    audioHeaderBytes: view.getUint8(9),
    sampleRate: view.getUint16(10, true),
    samplesPerFrame: view.getUint16(12, true),
    payloadBytes: view.getUint16(14, true),
  };
}

export function forwardSequenceDistance(previous, next) {
  return (next - previous + 0x10000) & 0xffff;
}

export function combineBlocks(blocks, totalBytes) {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const block of blocks) {
    output.set(block, offset);
    offset += block.byteLength;
  }
  if (offset !== totalBytes) {
    throw new Error(`Combined ${offset} bytes; expected ${totalBytes}`);
  }
  return output;
}

export function buildWavBlob(pcmBlocks, pcmByteLength, sampleRate = 16000) {
  const pcm = combineBlocks(pcmBlocks, pcmByteLength);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcm.byteLength, true);

  return new Blob([header, pcm], { type: "audio/wav" });
}
