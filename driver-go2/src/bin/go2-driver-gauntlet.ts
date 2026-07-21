#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildGo2DriverGauntletReport, go2DriverManifest, signGo2DriverGauntletReport } from "../go2-driver.ts";

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = run(process.argv.slice(2), process.env);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

export function run(argv, env = {}) {
  const [command, ...rest] = argv;
  try {
    if (command === "manifest") {
      return ok(go2DriverManifest());
    }
    if (command === "report") {
      const flags = parseFlags(rest);
      if (!flags.outcomes) {
        throw new CliError("OUTCOMES_REQUIRED", "report requires --outcomes <path>.");
      }
      const outcomes = JSON.parse(readFileSync(flags.outcomes, "utf8"));
      const report = buildGo2DriverGauntletReport({
        manifest: go2DriverManifest(),
        outcomes,
        ...(flags.generatedAt ? { generatedAt: flags.generatedAt } : {}),
        ...(flags.suiteVersion ? { suiteVersion: flags.suiteVersion } : {})
      });
      const privateKeyPath = flags.privateKey ?? env.GO2_GAUNTLET_PRIVATE_KEY;
      return ok(privateKeyPath ? signGo2DriverGauntletReport(report, readFileSync(privateKeyPath, "utf8")) : report);
    }
    return {
      exitCode: 2,
      stdout: "",
      stderr: [
        "Usage:",
        "  go2-driver-gauntlet manifest",
        "  go2-driver-gauntlet report --outcomes outcomes.json [--private-key key.pem] [--generated-at ISO]"
      ].join("\n") + "\n"
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: JSON.stringify({
        error_code: error.error_code ?? "GO2_GAUNTLET_CLI_ERROR",
        message: error.message
      }) + "\n"
    };
  }
}

class CliError extends Error {
  constructor(error_code, message) {
    super(message);
    this.name = "CliError";
    this.error_code = error_code;
  }
}

function ok(value) {
  return { exitCode: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "" };
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new CliError("INVALID_ARGUMENT", `Unexpected argument ${arg}.`);
    }
    const key = camelCase(arg.slice(2));
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new CliError("FLAG_VALUE_REQUIRED", `${arg} requires a value.`);
    }
    flags[key] = value;
    index += 1;
  }
  return flags;
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
