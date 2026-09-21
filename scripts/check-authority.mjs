import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const read = relative => readFileSync(resolve(root, relative), "utf8");
const checks = [
  ["README.md", source => source.includes("./docs/protocol-spacetimedb.md"), "README must link the selected protocol"],
  ["README.md", source => source.includes("World Operator"), "README must use World Operator terminology"],
  ["README.md", source => !source.includes("World Master"), "README still names the retired World Master role"],
  ["README.md", source => !source.includes("per-agent subscriptions"), "README still presents agent-managed subscriptions as canonical"],
  ["docs/protocol.md", source => source.includes("superseded") && source.includes("protocol-spacetimedb.md"), "old protocol must identify the selected protocol as authority"],
  ["docs/protocol-review.md", source => source.includes("historical") && source.includes("protocol-spacetimedb.md"), "protocol review must be historical risk evidence"],
  ["contracts/README.md", source => source.includes("spacetimedb") && source.includes("historical"), "contracts README must route readers to the selected protocol"],
];

const errors = [];
for (const [file, predicate, message] of checks) {
  if (!predicate(read(file))) errors.push(`${file}: ${message}`);
}

const canonical = read("docs/protocol-spacetimedb.md");
for (const required of ["World Operator", "local_map", "no room", "native subscription"]) {
  if (!canonical.toLowerCase().includes(required.toLowerCase())) errors.push(`canonical protocol is missing required rule: ${required}`);
}

if (errors.length) {
  console.error(errors.map(error => `authority: ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("authority: selected protocol and stale-authority checks passed");
}
