"use client";

import { useEffect, useRef, useState } from "react";
import type { OperatorEventPage } from "../../types/operator";
import { EMPTY_HISTORY, MAX_FEEDBACK_MISSIONS, readFeedbackThrough } from "./feedback-history";

export function useFeedbackHistory(
  scope: string,
  missionId: string | null,
  watermark: string,
  ready: boolean,
  read: (missionId: string, afterSequence: string) => Promise<OperatorEventPage>
) {
  const cache = useRef(new Map<string, OperatorEventPage>());
  const [view, setView] = useState({ key: "", history: EMPTY_HISTORY, error: false });
  const key = JSON.stringify([scope, missionId]);

  useEffect(() => {
    let cancelled = false;
    const previous = cache.current.get(key) ?? EMPTY_HISTORY;
    setView({ key, history: previous, error: false });
    if (!missionId || !ready) { return; }
    const load = async () => {
      try {
        const history = await readFeedbackThrough(read, missionId, previous, watermark, () => cancelled);
        if (cancelled) { return; }
        cache.current.delete(key);
        cache.current.set(key, history);
        if (cache.current.size > MAX_FEEDBACK_MISSIONS) {
          const oldest = cache.current.keys().next().value;
          if (oldest !== undefined) { cache.current.delete(oldest); }
        }
        setView({ key, history, error: false });
      } catch {
        if (!cancelled) { setView({ key, history: previous, error: true }); }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [key, missionId, read, ready, watermark]);

  return view.key === key ? view : { key, history: EMPTY_HISTORY, error: false };
}
