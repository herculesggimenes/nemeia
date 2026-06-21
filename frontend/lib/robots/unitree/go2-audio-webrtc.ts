const GO2_AUDIO_MAX_BYTES = 10 * 1024 * 1024;
const GO2_AUDIO_UPLOAD_CHUNK_SIZE = 61_440;
const GO2_AUDIO_SAMPLE_RATE = 16_000;

export type Go2AudioFileEntry = {
  ADD_TIME?: number | string;
  CUSTOM_NAME?: string;
  UNIQUE_ID?: string;
};

export type Go2AudioUploadCallbacks = {
  onProgress?: (progress: number) => void;
  publishAudioRequest: (apiId: number, payload: string) => Promise<unknown>;
};

function audioContextConstructor(): typeof AudioContext {
  return (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
}

function offlineAudioContextConstructor(): typeof OfflineAudioContext {
  return (window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeAudioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const channelCount = buffer.numberOfChannels;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: channelCount }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return wav;
}

export async function convertGo2AudioFileToWav(file: File): Promise<ArrayBuffer> {
  const input = await file.arrayBuffer();
  const Context = audioContextConstructor();
  const context = new Context();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(input.slice(0));
  } finally {
    void context.close();
  }

  const Offline = offlineAudioContextConstructor();
  const frameCount = Math.max(1, Math.ceil(decoded.duration * GO2_AUDIO_SAMPLE_RATE));
  const offline = new Offline(1, frameCount, GO2_AUDIO_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return encodeAudioBufferToWav(rendered);
}

function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(output);
}

function normalizeAudioList(response: unknown): Go2AudioFileEntry[] {
  try {
    let data = response as { data?: unknown; audio_list?: unknown; audioList?: unknown } | string | null;
    if (data && typeof data === "object" && "data" in data) {
      data = data.data as typeof data;
    }
    if (typeof data === "string") {
      data = JSON.parse(data) as typeof data;
    }
    if (data && typeof data === "object" && "data" in data) {
      const inner = data.data;
      data = typeof inner === "string" ? JSON.parse(inner) as typeof data : inner as typeof data;
    }
    const list = data && typeof data === "object" ? data.audio_list ?? data.audioList : null;
    return Array.isArray(list) ? list as Go2AudioFileEntry[] : [];
  } catch {
    return [];
  }
}

function entryTime(entry: Go2AudioFileEntry): number {
  return Number(entry.ADD_TIME ?? 0) || 0;
}

function uploadedAudioName(file: File): string {
  const base = file.name.replace(/\.[^/.]+$/, "");
  return `nemeia-${base}`.slice(0, 64);
}

export async function uploadAndPlayGo2AudioFile(file: File, callbacks: Go2AudioUploadCallbacks): Promise<{ durationSeconds: number; name: string; uniqueId: string }> {
  callbacks.onProgress?.(0);
  const wav = await convertGo2AudioFileToWav(file);
  const bytes = new Uint8Array(wav);

  if (bytes.byteLength > GO2_AUDIO_MAX_BYTES) {
    throw new Error(`Converted audio is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, above the Go2 10 MB AudioHub limit.`);
  }

  const name = uploadedAudioName(file);
  const base64 = bytesToBase64(bytes);
  const createTime = Math.floor(Date.now() / 1000);
  const chunks: string[] = [];
  for (let index = 0; index < base64.length; index += GO2_AUDIO_UPLOAD_CHUNK_SIZE) {
    chunks.push(base64.slice(index, index + GO2_AUDIO_UPLOAD_CHUNK_SIZE));
  }

  await chunks.reduce<Promise<void>>(async (previous, chunk, index) => {
    await previous;
    await callbacks.publishAudioRequest(2001, JSON.stringify({
      block_content: chunks[index],
      create_time: createTime,
      current_block_index: index + 1,
      current_block_size: chunk.length,
      file_name: name,
      file_size: bytes.byteLength,
      file_type: "wav",
      total_block_number: chunks.length
    }));
    callbacks.onProgress?.(Math.round(((index + 1) / chunks.length) * 85));
  }, Promise.resolve());

  await new Promise((resolve) => {
    setTimeout(resolve, 800);
  });
  const list = normalizeAudioList(await callbacks.publishAudioRequest(1001, "{}"));
  const match = list
    .filter((entry) => entry.CUSTOM_NAME === name && entry.UNIQUE_ID)
    .reduce<Go2AudioFileEntry | null>((newest, entry) => {
      if (!newest || entryTime(entry) > entryTime(newest)) {
        return entry;
      }

      return newest;
    }, null);

  if (!match?.UNIQUE_ID) {
    throw new Error("Go2 AudioHub upload finished, but the uploaded clip did not appear in the robot audio list.");
  }

  callbacks.onProgress?.(95);
  void callbacks.publishAudioRequest(1007, JSON.stringify({ play_mode: "no_cycle" }));
  await callbacks.publishAudioRequest(1002, JSON.stringify({ unique_id: match.UNIQUE_ID }));
  callbacks.onProgress?.(100);

  return {
    durationSeconds: Math.max(0, (bytes.byteLength - 44) / (GO2_AUDIO_SAMPLE_RATE * 2)),
    name,
    uniqueId: match.UNIQUE_ID
  };
}
