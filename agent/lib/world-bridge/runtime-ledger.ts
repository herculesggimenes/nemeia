import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DeliveryLedger } from "./delivery-ledger.ts";

let runtimeLedger: DeliveryLedger | undefined;

export function getRuntimeLedger(): DeliveryLedger {
  if (runtimeLedger !== undefined) return runtimeLedger;
  const filename = process.env.NEMEIA_AGENT_LEDGER ?? ".eve/nemeia-agent.sqlite";
  mkdirSync(dirname(filename), { recursive: true });
  runtimeLedger = new DeliveryLedger(filename);
  return runtimeLedger;
}
