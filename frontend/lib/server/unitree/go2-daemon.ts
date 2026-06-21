import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";

const DEFAULT_GO2_DAEMON_SOCKET = `/tmp/go2-cli-${process.getuid?.() ?? "user"}.sock`;

export type Go2DaemonResult = Record<string, unknown>;

export type Go2DaemonResponse = {
  error?: string;
  ok: boolean;
  result?: Go2DaemonResult;
  type?: string;
};

export type Go2AudioUpload = {
  bytes: number;
  path: string;
};

function daemonSocketPath(): string {
  return process.env.GO2_DAEMON_SOCKET || DEFAULT_GO2_DAEMON_SOCKET;
}

function daemonSshHost(): string | null {
  return process.env.GO2_DAEMON_SSH_HOST?.trim() || null;
}

function daemonErrorText(error: unknown): string {
  if (error instanceof Error) {
    if ("code" in error && error.code === "ENOENT") {
      return "Go2 daemon is not running.";
    }

    return error.message;
  }

  return String(error);
}

function runProcess(command: string, args: string[], options: { input?: string; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out.`));
    }, options.timeoutMs ?? 30_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}.`));
    });

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

async function requestRemoteGo2Daemon(host: string, command: string, params: Record<string, unknown>, timeoutMs: number): Promise<Go2DaemonResult> {
  const script = String.raw`
import json
import os
import socket
import sys

payload = json.loads(sys.stdin.read())
socket_path = os.environ.get("GO2_DAEMON_SOCKET") or f"/tmp/go2-cli-{os.getuid()}.sock"
sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.settimeout(max(1.0, float(payload.get("timeoutMs", 30000)) / 1000.0))
sock.connect(socket_path)
sock.sendall((json.dumps({"command": payload["command"], "params": payload.get("params") or {}}, separators=(",", ":")) + "\n").encode("utf-8"))
data = b""
while not data.endswith(b"\n"):
    chunk = sock.recv(65536)
    if not chunk:
        break
    data += chunk
sys.stdout.write(data.decode("utf-8"))
`;
  const encodedScript = Buffer.from(script, "utf8").toString("base64");
  const remoteCommand = `python3 -c "$(printf %s ${encodedScript} | base64 -d)"`;
  const stdout = await runProcess("ssh", [host, remoteCommand], {
    input: JSON.stringify({ command, params, timeoutMs }),
    timeoutMs: timeoutMs + 5_000
  });
  const response = JSON.parse(stdout) as Go2DaemonResponse;
  if (!response.ok) {
    throw new Error(response.error || `Go2 daemon ${command} failed.`);
  }

  if (!response.result || typeof response.result !== "object") {
    throw new Error(`Go2 daemon ${command} returned an invalid response.`);
  }

  return response.result;
}

export async function requestGo2Daemon(
  command: string,
  params: Record<string, unknown> = {},
  timeoutMs = 180_000
): Promise<Go2DaemonResult> {
  const sshHost = daemonSshHost();
  if (sshHost) {
    return await requestRemoteGo2Daemon(sshHost, command, params, timeoutMs);
  }

  return await new Promise((resolve, reject) => {
    const socket = new Socket();
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Go2 daemon timed out while running ${command}.`));
    }, timeoutMs);

    socket.setEncoding("utf8");
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(daemonErrorText(error)));
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.endsWith("\n")) {
        return;
      }

      clearTimeout(timer);
      socket.end();
      try {
        const response = JSON.parse(buffer) as Go2DaemonResponse;
        if (!response.ok) {
          reject(new Error(response.error || `Go2 daemon ${command} failed.`));
          return;
        }

        if (!response.result || typeof response.result !== "object") {
          reject(new Error(`Go2 daemon ${command} returned an invalid response.`));
          return;
        }

        resolve(response.result);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.once("close", () => {
      clearTimeout(timer);
      if (!buffer) {
        reject(new Error("Go2 daemon closed the connection without a response."));
      }
    });
    socket.connect(daemonSocketPath(), () => {
      socket.write(`${JSON.stringify({ command, params })}\n`);
    });
  });
}

export async function saveGo2AudioUpload(file: File): Promise<Go2AudioUpload> {
  const uploadDir = join(tmpdir(), "nemeia-go2-audio");
  await mkdir(uploadDir, { recursive: true });
  const suffix = file.name.includes(".") ? `.${file.name.split(".").pop() ?? "audio"}` : ".audio";
  const path = join(uploadDir, `go2-audio-${Date.now()}-${randomUUID()}${suffix}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path, bytes);

  const sshHost = daemonSshHost();
  if (sshHost) {
    const remotePath = `/tmp/nemeia-go2-audio/${path.split("/").pop() ?? `go2-audio-${randomUUID()}${suffix}`}`;
    await runProcess("ssh", [sshHost, "mkdir", "-p", "/tmp/nemeia-go2-audio"], { timeoutMs: 10_000 });
    await runProcess("scp", [path, `${sshHost}:${remotePath}`], { timeoutMs: 60_000 });
    return { bytes: bytes.byteLength, path: remotePath };
  }

  return { bytes: bytes.byteLength, path };
}
