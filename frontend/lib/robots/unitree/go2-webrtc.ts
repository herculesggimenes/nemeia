import type { Go2Callbacks, Go2ConnectionState, Go2DataChannelMessage } from "./go2-types";

export class Go2WebRtcConnection {
  private readonly callbacks: Go2Callbacks;
  private readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
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
    this.channel?.close();
    this.pc.close();
    this.setState("disconnected");
  }

  private setupPeerConnection(): void {
    this.pc.addTransceiver("video", { direction: "recvonly" });
    this.pc.addTransceiver("audio", { direction: "sendrecv" });

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
      }
    };

    this.pc.onconnectionstatechange = () => {
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
}
