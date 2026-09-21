import { LocalController } from "./local-controller.ts";
import {
  buildGeneratedControllerConnection,
  GeneratedControllerSession,
} from "./generated-controller-session.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}

export async function runSimulatedController(): Promise<never> {
  const unitId = required("NEMEIA_UNIT_ID");
  const controllerDb = process.env.NEMEIA_LOCAL_CONTROLLER_DB ?? `./controller-${unitId}.sqlite`;
  const controller = new LocalController({
    path: controllerDb,
    unitId,
    initialEpoch: BigInt(process.env.NEMEIA_CONTROLLER_INITIAL_EPOCH ?? "1"),
  });
  let session: GeneratedControllerSession | undefined;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await session?.stop();
    controller.close();
  };
  process.once("SIGINT", () => { void stop().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void stop().finally(() => process.exit(0)); });

  buildGeneratedControllerConnection({
    uri: required("NEMEIA_SPACETIMEDB_URI"),
    databaseName: required("NEMEIA_SPACETIMEDB_DATABASE"),
    token: process.env.NEMEIA_SPACETIMEDB_TOKEN,
    confirmedReads: true,
  }, (connection) => {
    session = new GeneratedControllerSession({
      connection,
      controller,
      unitId,
      diagnostics: (event) => {
        if (event.name.endsWith("_error") || event.name.endsWith("_failed")) {
          process.stderr.write(`${event.name}:${event.fields?.detail ?? "unknown"}\n`);
        }
      },
    });
    if (process.env.NEMEIA_SAFE_OBSERVATION_ID || process.env.NEMEIA_UNIT_OBSERVATION_ID || process.env.NEMEIA_TARGET_OBSERVATION_ID) {
      process.stderr.write("controller.cli_seed_diagnostic_only: live G3 feedback is required for canonical finish/safe proof\n");
    }
    void session.start().catch((error) => {
      process.stderr.write(`controller_session_start_failed:${String(error)}\n`);
    });
  }, (error) => {
    process.stderr.write(`world_connection_failed:${error.message}\n`);
  }, () => {
    void session?.stop();
  });

  return await new Promise<never>(() => undefined);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void runSimulatedController();
}
