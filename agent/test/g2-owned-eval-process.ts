import { spawn, type ChildProcess } from "node:child_process";

export type ProcessResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };
type Exit = { code: number | null; signal: NodeJS.Signals | null; at: string };
type Identity = { pid: number; started: string };
type StopProof = { verifiedStopped: true; observedPids: number[] };
type Tree = { add(pid: number): Promise<Identity | undefined>; capture(): Promise<void>; close(): Promise<StopProof> };
export type OwnedProcess = {
  child: ChildProcess; result: Promise<ProcessResult>; parentExit: Promise<Exit>;
  output(): string; exited(): ProcessResult | undefined;
  stop(): Promise<ProcessResult>; stopped(): boolean;
  lifecycle(): { rootIdentity?: Identity; exit?: Exit; close?: Exit; cleanupStartedAt?: string; stopProof?: StopProof; ownership: string };
};

export async function startOwned(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<OwnedProcess> {
  // Reuse Integration's /proc ancestry + start-time fencing; no root edits and
  // no raw negative-PID signalling after the original group leader has exited.
  const moduleUrl = new URL("../../scripts/owned-process-tree.mjs", import.meta.url).href;
  const { ownedProcessTree } = await import(moduleUrl) as { ownedProcessTree(): Tree };
  const tree = ownedProcessTree();
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", completed: ProcessResult | undefined;
  let exit: Exit | undefined, close: Exit | undefined, rootIdentity: Identity | undefined, trackingError: unknown;
  let cleanupStartedAt: string | undefined, stopProof: StopProof | undefined, stopping: Promise<ProcessResult> | undefined;
  child.stdout?.setEncoding("utf8").on("data", (data: string) => { stdout = (stdout + data).slice(-2_000_000); });
  child.stderr?.setEncoding("utf8").on("data", (data: string) => { stderr = (stderr + data).slice(-500_000); });
  const parentExit = new Promise<Exit>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => { exit = { code, signal, at: new Date().toISOString() }; resolve(exit); });
  });
  const result = new Promise<ProcessResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      close = { code, signal, at: new Date().toISOString() };
      completed = { code, signal, stdout, stderr }; resolve(completed);
    });
  });
  void parentExit.catch(() => {}); void result.catch(() => {});
  try {
    if (child.pid === undefined) throw new Error("qualification child has no owned PID");
    rootIdentity = await tree.add(child.pid);
    await tree.capture();
  } catch (error) { trackingError = error; }
  // Capture ancestry while the parent is alive, before an orphan can lose it.
  let capturing = false;
  const timer = setInterval(() => {
    if (capturing || trackingError) return;
    capturing = true;
    void tree.capture().catch((error: unknown) => { trackingError = error; }).finally(() => { capturing = false; });
  }, 100);
  timer.unref();
  return {
    child, result, parentExit, output: () => stdout, exited: () => completed,
    stopped: () => stopProof?.verifiedStopped === true && completed !== undefined,
    lifecycle: () => ({ rootIdentity, exit, close, cleanupStartedAt, stopProof, ownership: "scripts/owned-process-tree.mjs:ancestry+starttime" }),
    stop() {
      return stopping ??= (async () => {
        cleanupStartedAt = new Date().toISOString(); clearInterval(timer);
        const proof = await tree.close();
        if (trackingError) throw trackingError;
        if (!rootIdentity || !proof.observedPids.includes(rootIdentity.pid)) throw new Error("owned process ancestry was not established");
        const closed = await bounded(result, 2_000);
        if (!closed) throw new Error("owned processes stopped but inherited stdio did not close");
        stopProof = proof;
        return closed;
      })();
    },
  };
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

export const stopOwned = (owned: OwnedProcess): Promise<ProcessResult> => owned.stop();

/** The public CLI verdict is required, but never substitutes for process exit. */
export function automaticEvalVerdict(stdout: string, targetUrl: string, bashCalls: number): { completedAt: string; passed: true } | undefined {
  const start = stdout.search(/^\{\s*\n\s*"target"/mu);
  if (start < 0) return undefined;
  let report;
  try { report = JSON.parse(stdout.slice(start)); } catch { return undefined; }
  const result = report.results?.[0];
  if (report.target?.kind !== "local" || report.target?.url !== targetUrl ||
    report.passed !== 1 || report.failed !== 0 || report.errored !== 0 || report.skipped !== 0 || report.scored !== 0 ||
    report.results?.length !== 1 || result?.id !== "automatic-wake" || result.verdict !== "passed" || result.error !== undefined ||
    typeof report.completedAt !== "string" || !Array.isArray(result.assertions) ||
    result.assertions.some((item: { passed?: unknown }) => item.passed !== true) ||
    !result.assertions.some((item: { name?: string; severity?: string }) => item.name === "succeeded" && item.severity === "gate") ||
    !result.assertions.some((item: { name?: string; severity?: string; metadata?: { matchingCalls?: number } }) =>
      item.name === "calledTool(bash)" && item.severity === "gate" && item.metadata?.matchingCalls === bashCalls)) {
    throw new Error("automatic public CLI report did not pass its exact eval/assertion contract");
  }
  return { completedAt: report.completedAt, passed: true };
}

export async function finishAutomaticEval(owned: OwnedProcess, options: {
  targetUrl: string; bashCalls: number; verdictTimeoutMs?: number; shutdownTimeoutMs?: number;
}): Promise<{ result: ProcessResult; verdict: { completedAt: string; passed: true }; verdictObservedAt: string; shutdownTimeoutMs: number }> {
  const verdictTimeoutMs = options.verdictTimeoutMs ?? 15_000;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 35_000;
  if (![verdictTimeoutMs, shutdownTimeoutMs].every((value) => Number.isSafeInteger(value) && value > 0) || verdictTimeoutMs > 15_000 || shutdownTimeoutMs > 35_000) throw new Error("invalid bounded Eve shutdown budget");
  const deadline = Date.now() + verdictTimeoutMs;
  let verdict;
  while (!(verdict = automaticEvalVerdict(owned.output(), options.targetUrl, options.bashCalls))) {
    if (owned.exited()) throw new Error("automatic Eve closed without its complete public verdict");
    if (Date.now() >= deadline) throw new Error("automatic Eve public verdict timed out");
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  const verdictObservedAt = new Date().toISOString();
  // Eve 0.63 prints JSON before dev-runner's 15s shutdown grace. Do not race
  // that grace or confuse an exited parent with a descendant-held stdout pipe.
  const exit = await bounded(owned.parentExit, shutdownTimeoutMs);
  if (!exit) throw new Error("automatic Eve parent did not exit within post-verdict shutdown budget");
  if (exit.code !== 0 || exit.signal !== null || owned.lifecycle().cleanupStartedAt !== undefined) {
    throw new Error(`automatic Eve parent did not exit naturally with code 0 (code=${exit.code}, signal=${exit.signal})`);
  }
  const result = await owned.stop(); // Start-time-fenced descendants, even if close already fired.
  if (result.code !== 0 || result.signal !== null || !owned.stopped()) throw new Error("automatic Eve exit/close/owned cleanup evidence disagrees");
  return { result, verdict, verdictObservedAt, shutdownTimeoutMs };
}
