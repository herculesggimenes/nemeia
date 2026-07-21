#!/usr/bin/env node
import { NemeiaCtl } from "../nemeiactl.ts";

const cli = NemeiaCtl.withSim();
const result = await cli.run(process.argv.slice(2), process.env);
process.stdout.write(result.stdout);
process.exitCode = result.exitCode;
