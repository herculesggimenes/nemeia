import type { RelevantExecutionRow } from "@nemeia/world-client/src/index.ts";

export function resultLabel(value: RelevantExecutionRow["result"]): string | null {
  if (!value) { return null; }
  switch (value.tag) {
    case "Succeeded": {
      const completion = value.value.completion;
      const proof = completion.value;
      return completion.tag === "Navigate"
        ? `navigate succeeded · Unit pose ${proof.unitObservationId} · receipt ${proof.localReceiptId}`
        : `approach succeeded · ${completion.value.measuredDistanceM.toFixed(2)} m measured · Unit ${proof.unitObservationId} · target ${completion.value.targetObservationId} · receipt ${proof.localReceiptId}`;
    }
    case "Cancelled": return `cancelled · ${value.value.localReceiptId}`;
    case "Failed": return `failed · ${value.value.code}`;
  }
}
