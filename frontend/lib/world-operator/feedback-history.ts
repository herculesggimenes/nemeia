import type { OperatorEventPage } from "../../types/operator.ts";

export const MAX_FEEDBACK_EVENTS = 128;
export const MAX_FEEDBACK_MISSIONS = 16;
export const EMPTY_HISTORY: OperatorEventPage = { events: [], historyGap: false, nextSequence: "0" };

/** A bounded, disposable read cache. Only confirmed procedure rows enter it. */
export function mergeFeedbackPage(previous: OperatorEventPage, page: OperatorEventPage, missionId: string): OperatorEventPage {
  const rows = new Map(previous.events.map((event) => [event.id, event]));
  for (const event of page.events) {
    if (event.subjectId === missionId && event.kind === "mission.finding_rejected") { rows.set(event.id, event); }
  }
  const ordered = [...rows.values()].toSorted((left, right) => {
    const a = BigInt(left.sequence ?? "0");
    const b = BigInt(right.sequence ?? "0");
    return a < b ? -1 : a === b ? 0 : 1;
  });
  return {
    events: ordered.slice(-MAX_FEEDBACK_EVENTS),
    historyGap: previous.historyGap || page.historyGap || ordered.length > MAX_FEEDBACK_EVENTS,
    nextSequence: BigInt(previous.nextSequence) > BigInt(page.nextSequence) ? previous.nextSequence : page.nextSequence,
  };
}

export async function readFeedbackThrough(
  read: (missionId: string, afterSequence: string) => Promise<OperatorEventPage>,
  missionId: string,
  previous: OperatorEventPage,
  watermark: string,
  cancelled: () => boolean
): Promise<OperatorEventPage> {
  let history = previous;
  // Bound catch-up work as well as retained rows. A distant watermark can be
  // read as a recent bounded window after this budget, with a gap notice.
  for (let pageIndex = 0; pageIndex < 8 && !cancelled(); pageIndex += 1) {
    const cursor = history.nextSequence;
    // oxlint-disable-next-line no-await-in-loop
    const page = await read(missionId, cursor);
    history = mergeFeedbackPage(history, page, missionId);
    if (BigInt(history.nextSequence) >= BigInt(watermark)) { return history; }
    if (history.nextSequence === cursor) { break; }
  }
  if (!cancelled() && BigInt(history.nextSequence) < BigInt(watermark)) {
    // Reading only watermark - 1 drops nearby previous feedback on a cold tab.
    // At most 128 sequence positions are included, using the same bounded API.
    const windowStart = BigInt(watermark) - BigInt(MAX_FEEDBACK_EVENTS);
    const latest = await read(missionId, (windowStart > 0n ? windowStart : 0n).toString());
    history = mergeFeedbackPage(history, { ...latest, historyGap: true }, missionId);
  }
  return history;
}
