import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const screenshots = ["readonly-1440.png", "readonly-evidence-1440.png", "readonly-390.png", "readonly-evidence-390.png", "review-390.png", "review-1440.png"];

/** Archive only artifacts written by this successful native browser invocation.
 * The UI helper owns its browser assertions; no old summary counts as proof. */
export async function archiveNativeBrowserEvidence({ logPath, sourceDirectory, destination, startedAt, exitCode }) {
  if (exitCode !== 0) throw new Error("native browser qualification exited unsuccessfully");
  const log = await readFile(logPath, "utf8");
  const checks = {
    resourceBytesAndAuthorization: log.includes("PASS native authorized PNG: digest, partial range, missing auth, wrong ref/context and invalid range"),
    responsiveSubscriptionReconnect: log.includes("PASS native subscription, retained image decode, desktop/mobile layout and reconnect"),
    createAssignGrantReviewHistory: log.includes("PASS create, same-Agent multi-mission assignment, grant, stable evidence selection and persistent rejection history"),
    acceptedProofConflictDisconnect: log.includes("PASS native accept with connected identity, durable proof, mobile review, revision conflict and disconnect/reconnect"),
  };
  const evidence = log.split("\n").flatMap((line) => {
    try { const value = JSON.parse(line); return value.missions && value.selectedEvidence && value.conflict ? [value] : []; }
    catch { return []; }
  }).at(-1);
  if (!evidence || Object.values(checks).some((value) => value !== true)) throw new Error("native browser evidence is incomplete");
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const artifacts = [];
  for (const name of screenshots) {
    const source = join(sourceDirectory, name);
    if ((await stat(source)).mtimeMs < startedAt) throw new Error(`stale browser artifact: ${name}`);
    const path = join(destination, name);
    await copyFile(source, path, constants.COPYFILE_EXCL);
    await chmod(path, 0o600);
    artifacts.push({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
  }
  return { checks, evidence, artifacts, logPath };
}
