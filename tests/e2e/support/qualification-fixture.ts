import { mkdir, open, readFile, stat } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ownedProcessTree, signalOwnedGroup } from "../../../scripts/owned-process-tree.mjs";
import { test as base } from "@playwright/test";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

const EXPECTED_CHECKS: Record<string, readonly string[]> = Object.freeze({
  G1: ["actualModule", "adminAuthorizedGeneratedViews", "changedBodyReplayRejected", "corruptResourceRejected", "fixtureBackedRetention", "generatedDbConnection", "missingResourceRejected", "processRestart", "resourceBytesVerifiedAfterRestart", "resourceGatewayReopenedAfterRestart", "retainedDataAfterRestart", "sameBodyReplayNoNewRows", "sameScopedIdentityAfterRestart", "scopedWorkerRead", "sourceAcquisitionTimesPreserved"],
  G2: ["actualEveLifecycle", "actualGeneratedWorldSubscription", "authenticatedJustBashRead", "injectedModel", "nextStepFresh", "revokedAccessDenied", "sameStepPinned", "usefulWorldContext", "worldChangedDuringThinking"],
  automaticWake: ["actionFreeBash", "actualPublicEvalPassed", "bridgeStoppedCleanly", "busyBurstCoalesced", "eveParentExitedNaturally", "explicitBaselineMissionAssigned", "idleNextDelivery", "initialLoadExcluded", "measuredNativeMissionInWake", "nextStepFresh", "noExecutionCreated", "noExecutionMutation", "observedNodeMatchesInventory", "ownedChildrenStopped", "ownedMissionsCancelled", "publicMockModelLifecycle", "publicTargetAndCursor", "qualificationSubscribersClosed", "sameStepPinned", "subsequentNativeUpdate", "unitGrantPrepared", "usefulIntactWorldContext"],
  G3: ["acceptedBeforeClaimCancel", "actualEve", "actualModule", "admissionClaim", "measuredFeedback", "missionAssignment", "missionDeadlineWithoutExecutions", "noDuplicateRetry", "processRestart", "retainedControllerReceipt", "retainedDataAfterRestart", "reviewedObjectiveProgress", "safeCancellation", "sameScopedIdentityAfterRestart", "scopedWorldOperator", "sourceAcquisitionTimesPreserved", "trustedAgentCommand", "unitGrant"],
  E7: ["acceptedProofConflictDisconnect", "createAssignGrantReviewHistory", "resourceBytesAndAuthorization", "responsiveSubscriptionReconnect"],
});

type E2EResult = {
  compositionRoot: string;
  cleanupVerified: boolean;
  evidenceDirectory: string;
  ownerPid: number;
  result: "pass" | "fail";
  verificationPath: string;
};

type SafeSummary = {
  checks: Record<string, boolean>;
  claimable: boolean;
  gate: string;
  result: string;
};

export type QualificationRun = {
  artifactDirectory: string;
  approvedScreenshotPath: (name: string) => Promise<string>;
  readSafeSummary: (gate: string) => Promise<SafeSummary>;
  start: () => Promise<void>;
  waitForCompletion: () => Promise<E2EResult>;
  waitForPhase: (phase: string) => Promise<void>;
};

type WorkerFixtures = { qualification: QualificationRun };

export const test = base.extend<{}, WorkerFixtures>({
  qualification: [async ({}, use) => {
    const run = createQualificationRun();
    try {
      await use(run);
    } finally {
      await stopOwnedRun(run);
    }
  }, { scope: "worker" }],
});

type InternalQualificationRun = QualificationRun & {
  child?: ChildProcess;
  identity?: { pid: number; started: string };
  ownedTree?: ReturnType<typeof ownedProcessTree>;
  treeTimer?: NodeJS.Timeout;
};

function createQualificationRun(): InternalQualificationRun {
  const artifactDirectory = join(root, ".artifacts", "qualification", "e2e", `run-${process.pid}-${Date.now()}-${randomUUID()}`);
  const phaseEventsPath = join(artifactDirectory, "phase-events.jsonl");
  const resultPath = join(artifactDirectory, "result.json");
  const logPath = join(artifactDirectory, "composition.log");
  let child: ChildProcess | undefined;
  let identity: { pid: number; started: string } | undefined;
  let exitPromise: Promise<{ code: number; signal: string | null }> | undefined;
  let exitState: { code: number; signal: string | null } | undefined;
  const ownedTree = ownedProcessTree();
  let treeTimer: NodeJS.Timeout | undefined;

  const run: InternalQualificationRun = {
    artifactDirectory,
    ownedTree,
    approvedScreenshotPath: async (name) => {
      if (!["readonly-1440.png", "readonly-evidence-1440.png", "readonly-390.png", "readonly-evidence-390.png", "review-390.png", "review-1440.png"].includes(name)) throw new Error("screenshot is not on the approved native evidence allowlist");
      const event = await phaseEvent("create-assign-grant-and-review-mission");
      const pathname = event.artifactPaths?.find((candidate) => candidate.endsWith(`/native-e7/${name}`));
      if (!pathname || !resolve(pathname).startsWith(`${resolve(artifactDirectory)}/`)) throw new Error(`approved screenshot is not an owned phase artifact: ${name}`);
      await stat(pathname);
      return pathname;
    },
    readSafeSummary: async (gate) => {
      const phase = { G1: "retain-map-and-evidence-across-restart", G2: "pin-agent-and-verify-fresh-wake", automaticWake: "pin-agent-and-verify-fresh-wake", G3: "execute-once-and-cancel-safely", E7: "create-assign-grant-and-review-mission" }[gate];
      if (!phase) throw new Error(`unknown qualification gate: ${gate}`);
      const event = await phaseEvent(phase);
      const reportPath = event.reportPaths?.[gate === "automaticWake" ? 1 : 0];
      if (!reportPath || !resolve(reportPath).startsWith(`${resolve(artifactDirectory)}/`)) throw new Error(`qualification report is outside the owned composition: ${gate}`);
      const report = await readJson<{ gate?: string; result?: string; claimable?: boolean; checks?: Record<string, unknown> }>(reportPath);
      const expectedGate = { G1: "G1", G2: "G2", automaticWake: "G2-automatic-wake", G3: "G3", E7: "E7" }[gate];
      if (report.gate !== expectedGate || report.result !== "pass" || report.claimable !== true) throw new Error(`qualification report is not a fresh passing ${gate} report`);
      const expectedChecks = EXPECTED_CHECKS[gate];
      const actualChecks = report.checks ?? {};
      if (!expectedChecks || Object.keys(actualChecks).length !== expectedChecks.length || expectedChecks.some((name) => actualChecks[name] !== true)) throw new Error(`qualification report has incomplete checks: ${gate}`);
      const checks = Object.fromEntries(expectedChecks.map((name) => [name, true]));
      return {
        gate,
        result: report.result ?? "unknown",
        claimable: report.claimable === true,
        checks,
      };
    },
    start: async () => {
      if (child) throw new Error("qualification already started");
      if (process.env.NEMEIA_UI_URL) throw new Error("full E2E refuses an existing UI service; it owns a fresh composition");
      await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
      const logHandle = await open(logPath, "w", 0o600);
      process.env.PWDEBUG = "0";
      delete process.env.DEBUG;
      delete process.env.DEBUG_FILE;
      const childEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !["DEBUG", "DEBUG_FILE"].includes(name)));
      childEnvironment.PWDEBUG = "0";
      child = spawn(process.execPath, [join(root, "scripts", "run-ui-composition.mjs"), "--verify"], {
        cwd: root,
        detached: true,
        env: {
          ...childEnvironment,
          NEMEIA_UI_COMPOSITION_DIR: join(artifactDirectory, "composition"),
          NEMEIA_PHASE_EVENTS_FILE: phaseEventsPath,
          NEMEIA_E2E_RESULT_FILE: resultPath,
        },
        stdio: ["ignore", logHandle.fd, logHandle.fd],
      });
      const ownedChild = child;
      exitPromise = new Promise((resolveExit) => {
        ownedChild.once("error", () => { exitState = { code: 1, signal: "error" }; resolveExit(exitState); });
        ownedChild.once("exit", (code, signal) => { exitState = { code: code ?? 1, signal }; resolveExit(exitState); });
      });
      await logHandle.close();
      if (!child.pid) throw new Error("owned qualification did not publish a process identity");
      identity = await processIdentity(child.pid);
      if (!identity) throw new Error("owned qualification exited before start-time fencing");
      run.child = child;
      run.identity = identity;
      await ownedTree.add(child.pid);
      treeTimer = setInterval(() => { ownedTree.capture().catch(() => undefined); }, 500);
      treeTimer.unref();
      run.treeTimer = treeTimer;
    },
    waitForCompletion: async () => {
      if (!exitPromise) throw new Error("qualification has not started");
      const exit = await exitPromise;
      const deadline = Date.now() + 5_000;
      for (;;) {
        try {
          const result = await readJson<E2EResult>(resultPath);
          if (result.result !== "pass" || exit.code !== 0 || result.cleanupVerified !== true) throw new Error(`full E2E qualification failed (exit ${exit.code}${exit.signal ? `, ${exit.signal}` : ""})`);
          return result;
        } catch (error) {
          if (error instanceof Error && error.message !== "owned qualification result unavailable") throw error;
          if (Date.now() >= deadline) throw new Error("owned qualification result unavailable");
          await delay(100);
        }
      }
    },
    waitForPhase: async (phase) => {
      if (!exitPromise) throw new Error("qualification has not started");
      const deadline = Date.now() + 1_200_000;
      for (;;) {
        const events = await readPhaseEvents(phaseEventsPath);
        if (events.some((event) => event.phase === phase && event.result === "pass")) return;
        if (exitState) throw new Error(`qualification exited before phase ${phase} (exit ${exitState.code}${exitState.signal ? `, ${exitState.signal}` : ""})`);
        if (Date.now() >= deadline) throw new Error(`qualification did not reach phase ${phase}`);
        await delay(250);
      }
    },
  };
  async function phaseEvent(phase: string): Promise<PhaseEvent> {
    const event = (await readPhaseEvents(phaseEventsPath)).find((candidate) => candidate.phase === phase && candidate.result === "pass");
    if (!event) throw new Error(`qualification phase is not complete: ${phase}`);
    return event;
  }
  return run;
}

type PhaseEvent = { artifactPaths?: string[]; phase: string; reportPaths?: string[]; result: string };

async function stopOwnedRun(run: InternalQualificationRun): Promise<void> {
  const active = run.child && run.identity && run.child.exitCode === null && run.child.signalCode === null;
  if (active) {
    await signalOwnedGroup(run.identity, "SIGTERM");
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline && run.child.exitCode === null && run.child.signalCode === null) await delay(100);
    if (run.child.exitCode === null && run.child.signalCode === null) await signalOwnedGroup(run.identity, "SIGKILL");
  }
  if (run.treeTimer) clearInterval(run.treeTimer);
  if (run.ownedTree) {
    await run.ownedTree.capture();
    const evidence = await run.ownedTree.close();
    if (evidence.verifiedStopped !== true) throw new Error("owned E2E descendants were not verified stopped");
  }
}

async function processIdentity(pid: number): Promise<{ pid: number; started: string } | undefined> {
  try {
    const text = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/u);
    return { pid, started: fields[19] };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["ENOENT", "ESRCH"].includes(error.code as string)) return undefined;
    throw new Error("owned qualification process identity unavailable");
  }
}

async function readPhaseEvents(pathname: string): Promise<PhaseEvent[]> {
  try {
    const text = await readFile(pathname, "utf8");
    return text.split("\n").flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return typeof value?.phase === "string" ? [value as PhaseEvent] : [];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw new Error("owned qualification phase events unavailable");
  }
}

async function readJson<T>(pathname: string): Promise<T> {
  try {
    return JSON.parse(await readFile(pathname, "utf8")) as T;
  } catch {
    throw new Error("owned qualification result unavailable");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
