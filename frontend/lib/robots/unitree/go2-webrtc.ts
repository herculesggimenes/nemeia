import type { Go2AudioInputStats, Go2Callbacks, Go2ConnectionState, Go2DataChannelMessage } from "./go2-types";

export class Go2WebRtcConnection {
  private readonly callbacks: Go2Callbacks;
  private readonly pc: RTCPeerConnection;
  private audioSender: RTCRtpSender | null = null;
  private channel: RTCDataChannel | null = null;
  private inputAudioContext: AudioContext | null = null;
  private inputGainNode: GainNode | null = null;
  private inputVolume = 0.8;
  private microphoneStream: MediaStream | null = null;
  private audioInputStatsTimer: ReturnType<typeof setInterval> | null = null;
  private currentAudioInputTrack: MediaStreamTrack | null = null;
  private currentAudioInputSource: Go2AudioInputStats["source"] = "none";
  private lastAudioInputBytesSent = 0;
  private primingAudioContext: AudioContext | null = null;
  private state: Go2ConnectionState = "idle";
  private readonly sendQueue: string[] = [];

  constructor(callbacks: Go2Callbacks) {
    this.callbacks = callbacks;
    this.pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
    this.setupPeerConnection();
  }

  async createOffer(): Promise<string> {
    this.setState("connecting");
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    await new Promise<void>((resolve) => {
      if (this.pc.iceGatheringState === "complete") {
        resolve();
        return;
      }

      this.pc.onicegatheringstatechange = () => {
        if (this.pc.iceGatheringState === "complete") {
          resolve();
        }
      };
    });

    return this.pc.localDescription?.sdp ?? "";
  }

  async setAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: "answer", sdp });
  }

  send(message: Go2DataChannelMessage): void {
    const payload = JSON.stringify(message);
    if (this.channel?.readyState === "open") {
      this.channel.send(payload);
      return;
    }

    this.sendQueue.push(payload);
  }

  close(): void {
    this.clearAudioInputTrackState();
    this.stopPrimingAudio();
    this.stopMicrophone();
    this.channel?.close();
    this.pc.close();
    this.setState("disconnected");
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (!this.audioSender) {
      throw new Error("Go2 audio sender is not available");
    }

    if (!enabled) {
      await this.audioSender.replaceTrack(null);
      this.clearAudioInputTrackState();
      this.stopMicrophone();
      await this.primeAudioInput();
      return;
    }

    this.stopMicrophone();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is unavailable.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const track = this.createInputTrack(stream);
    if (!track) {
      stream.getTracks().forEach((streamTrack) => streamTrack.stop());
      throw new Error("No microphone track was provided by the browser");
    }

    await this.inputAudioContext?.resume();
    await this.audioSender.replaceTrack(track);
    this.setAudioInputTrackState(track, "microphone");
    this.microphoneStream = stream;
  }

  async primeAudioInput(): Promise<void> {
    if (!this.audioSender || this.currentAudioInputSource !== "none") {
      return;
    }

    this.stopPrimingAudio();
    this.primingAudioContext = new AudioContext();
    const oscillator = this.primingAudioContext.createOscillator();
    const gain = this.primingAudioContext.createGain();
    const destination = this.primingAudioContext.createMediaStreamDestination();
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    const track = destination.stream.getAudioTracks()[0] ?? null;
    if (!track) {
      void this.primingAudioContext.close();
      this.primingAudioContext = null;
      return;
    }

    await this.primingAudioContext.resume();
    await this.audioSender.replaceTrack(track);
    this.setAudioInputTrackState(track, "priming");
  }

  async setAudioInputTrack(track: MediaStreamTrack | null): Promise<void> {
    if (!this.audioSender) {
      throw new Error("Go2 audio sender is not available");
    }

    this.stopMicrophone();
    this.stopPrimingAudio();
    await this.audioSender.replaceTrack(track);
    if (track) {
      this.setAudioInputTrackState(track, "file");
      return;
    }

    this.clearAudioInputTrackState();
    await this.primeAudioInput();
  }

  setAudioInputVolume(volume: number): void {
    this.inputVolume = Math.min(Math.max(volume, 0), 1);
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = this.inputVolume;
    }
  }

  private setupPeerConnection(): void {
    this.pc.addTransceiver("video", { direction: "recvonly" });
    this.audioSender = this.pc.addTransceiver("audio", { direction: "sendrecv" }).sender;

    this.channel = this.pc.createDataChannel("data", { ordered: true });
    this.channel.binaryType = "arraybuffer";
    this.setupChannelHandlers(this.channel);

    this.pc.ondatachannel = (event) => {
      event.channel.binaryType = "arraybuffer";
      this.setupChannelHandlers(event.channel);
      if (!this.channel || this.channel.readyState !== "open") {
        this.channel = event.channel;
      }
    };

    this.pc.ontrack = (event) => {
      if (event.track.kind === "video") {
        this.callbacks.onVideoTrack(event.streams[0] ?? new MediaStream([event.track]));
        return;
      }

      if (event.track.kind === "audio") {
        this.callbacks.onAudioTrack(event.streams[0] ?? new MediaStream([event.track]));
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "connected") {
        this.setState("connected");
        return;
      }
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") {
        this.setState("failed");
      }
      if (this.pc.connectionState === "connecting") {
        this.setState("connecting");
      }
    };
  }

  private setupChannelHandlers(channel: RTCDataChannel): void {
    channel.addEventListener("open", () => {
      this.channel = channel;
      this.setState("connected");
      while (this.sendQueue.length > 0) {
        const next = this.sendQueue.shift();
        if (next) {
          channel.send(next);
        }
      }
    });

    channel.addEventListener("close", () => this.setState("disconnected"));
    channel.addEventListener("message", (event) => this.handleChannelMessage(event.data));
  }

  private handleChannelMessage(data: ArrayBuffer | string): void {
    if (typeof data === "string") {
      this.parseJsonMessage(data);
      return;
    }

    if (data.byteLength < 4) {
      return;
    }

    const view = new DataView(data);
    const first = view.getUint16(0, true);
    const second = view.getUint16(2, true);

    if (first === 2 && second === 0 && data.byteLength >= 12) {
      this.parseBinaryFramedMessage(data, 12, view.getUint32(4, true));
      return;
    }

    if (first > 0 && first < 60000 && 4 + first <= data.byteLength) {
      this.parseBinaryFramedMessage(data, 4, first);
      return;
    }

    const bytes = new Uint8Array(data);
    this.parseJsonMessage(new TextDecoder().decode(bytes));
  }

  private parseJsonMessage(raw: string): void {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return;
    }

    try {
      this.callbacks.onMessage(JSON.parse(raw.substring(start, end + 1)) as Go2DataChannelMessage);
    } catch {
      // Ignore malformed robot frames.
    }
  }

  private parseBinaryFramedMessage(data: ArrayBuffer, jsonStart: number, jsonLength: number): void {
    if (jsonLength <= 0 || jsonStart + jsonLength > data.byteLength) {
      return;
    }

    const jsonBytes = new Uint8Array(data, jsonStart, jsonLength);
    const json = new TextDecoder().decode(jsonBytes);
    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return;
    }

    try {
      const message = JSON.parse(json.substring(start, end + 1)) as Go2DataChannelMessage;
      const payloadStart = jsonStart + jsonLength;
      if (payloadStart < data.byteLength && message.data && typeof message.data === "object") {
        (message.data as Record<string, unknown>).data = data.slice(payloadStart);
      }
      this.callbacks.onMessage(message);
    } catch {
      // Ignore malformed robot frames.
    }
  }

  private setState(state: Go2ConnectionState): void {
    if (this.state === state) {
      return;
    }

    this.state = state;
    this.callbacks.onStateChange(state);
  }

  private stopMicrophone(): void {
    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream = null;
    this.inputGainNode = null;
    void this.inputAudioContext?.close();
    this.inputAudioContext = null;
  }

  private clearAudioInputTrackState(): void {
    this.currentAudioInputTrack = null;
    this.currentAudioInputSource = "none";
    this.lastAudioInputBytesSent = 0;
    if (this.audioInputStatsTimer) {
      clearInterval(this.audioInputStatsTimer);
      this.audioInputStatsTimer = null;
    }
    this.callbacks.onAudioInputStats({
      bytesSent: 0,
      packetsSent: 0,
      source: "none",
      streaming: false,
      trackState: "detached"
    });
  }

  private createInputTrack(stream: MediaStream): MediaStreamTrack | null {
    const sourceTrack = stream.getAudioTracks()[0] ?? null;
    if (!sourceTrack) {
      return null;
    }

    this.inputAudioContext = new AudioContext();
    const source = this.inputAudioContext.createMediaStreamSource(stream);
    const gain = this.inputAudioContext.createGain();
    const destination = this.inputAudioContext.createMediaStreamDestination();
    gain.gain.value = this.inputVolume;
    source.connect(gain);
    gain.connect(destination);
    this.inputGainNode = gain;
    return destination.stream.getAudioTracks()[0] ?? null;
  }

  private setAudioInputTrackState(track: MediaStreamTrack, source: Go2AudioInputStats["source"]): void {
    this.currentAudioInputTrack = track;
    this.currentAudioInputSource = source;
    this.lastAudioInputBytesSent = 0;
    this.callbacks.onAudioInputStats({
      bytesSent: 0,
      packetsSent: 0,
      source,
      streaming: false,
      trackState: track.readyState
    });

    if (this.audioInputStatsTimer) {
      clearInterval(this.audioInputStatsTimer);
    }
    this.audioInputStatsTimer = setInterval(() => {
      void this.publishAudioInputStats();
    }, 500);
    void this.publishAudioInputStats();
  }

  private async publishAudioInputStats(): Promise<void> {
    const trackState = this.currentAudioInputTrack?.readyState ?? "ended";
    if (!this.audioSender) {
      return;
    }

    const stats = await this.audioSender.getStats();
    const outbound = this.findOutboundAudioStats(stats);
    const bytesSent = outbound.bytesSent;
    const packetsSent = outbound.packetsSent;
    const streaming = trackState === "live" && bytesSent > this.lastAudioInputBytesSent;
    this.lastAudioInputBytesSent = bytesSent;
    this.callbacks.onAudioInputStats({ bytesSent, packetsSent, source: this.currentAudioInputSource, streaming, trackState });
  }

  private findOutboundAudioStats(stats: RTCStatsReport): Pick<Go2AudioInputStats, "bytesSent" | "packetsSent"> {
    for (const report of stats.values()) {
      const candidate = report as Record<string, unknown>;
      if (candidate.type !== "outbound-rtp") {
        continue;
      }

      if (candidate.kind !== "audio" && candidate.mediaType !== "audio") {
        continue;
      }

      return {
        bytesSent: typeof candidate.bytesSent === "number" ? candidate.bytesSent : 0,
        packetsSent: typeof candidate.packetsSent === "number" ? candidate.packetsSent : 0
      };
    }

    return { bytesSent: 0, packetsSent: 0 };
  }

  private stopPrimingAudio(): void {
    void this.primingAudioContext?.close();
    this.primingAudioContext = null;
  }
}
