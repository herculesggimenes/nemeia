import { readdir, readFile } from "node:fs/promises";

async function processRow(pid) {
  try {
    const text = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
    return { pid, state: fields[0], parent: Number(fields[1]), started: fields[19] };
  } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return undefined; throw error; }
}

export async function signalOwnedGroup(identity, signal, { inspect = processRow, send = process.kill } = {}) {
  if (!identity) return false;
  const current = await inspect(identity.pid);
  if (!current || current.started !== identity.started || ["Z", "X"].includes(current.state)) return false;
  try { send(-identity.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; return false; }
  return true;
}

/** Track only explicitly spawned roots and descendants observed while their
 * parentage is known. Start times fence PID reuse; no port-based process kill. */
export function ownedProcessTree() {
  const known = new Map();
  let serial = Promise.resolve();
  const add = async (pid) => { const row = await processRow(pid); if (row) known.set(pid, row); return row; };
  const capture = () => serial = serial.then(async () => {
    const rows = (await Promise.all((await readdir("/proc")).filter((name) => /^\d+$/.test(name)).map((name) => processRow(Number(name))))).filter(Boolean);
    const live = new Map(rows.map((row) => [row.pid, row]));
    let changed;
    do {
      changed = false;
      for (const row of rows) {
        const parent = known.get(row.parent);
        if (!known.has(row.pid) && parent && live.get(row.parent)?.started === parent.started) {
          known.set(row.pid, row); changed = true;
        }
      }
    } while (changed);
  });
  const alive = async () => (await Promise.all([...known.values()].map(async (saved) => {
    const current = await processRow(saved.pid);
    return current?.started === saved.started && !["Z", "X"].includes(current.state) ? current : undefined;
  }))).filter(Boolean);
  const signal = async (name) => {
    for (const row of await alive()) {
      try { process.kill(row.pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  };
  const close = async () => {
    await capture();
    await signal("SIGTERM");
    let deadline = Date.now() + 10_000;
    while ((await alive()).length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
    if ((await alive()).length) await signal("SIGKILL");
    deadline = Date.now() + 5_000;
    while ((await alive()).length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
    const remaining = (await alive()).map((row) => row.pid);
    if (remaining.length) throw new Error(`owned processes did not stop: ${remaining.join(",")}`);
    return { verifiedStopped: true, observedPids: [...known.keys()] };
  };
  return { add, capture, close };
}
