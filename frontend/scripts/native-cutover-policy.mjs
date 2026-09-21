import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const nativeHandlers = ["app/api/world/resources/read/route.ts", "app/api/world/resources/references/route.ts"];
// Empty, unauthenticated requests only. No real robot ID, host header or action payload.
export const retiredProbes = [
  ["GET", "/api/mission/cockpit"],
  ["POST", "/api/mission/cockpit/reset"],
  ["POST", "/api/mission/cockpit/robots/qualification-absent/stop"],
  ["POST", "/api/mission/cockpit/robots/qualification-absent/clear-stop"],
  ["POST", "/api/mission/cockpit/runs/qualification-absent/decision"],
  ...["GET", "HEAD", "POST"].map((method) => [method, "/api/robots/go2/proxy/qualification-absent"]),
];

function files(directory) {
  if (!existsSync(directory)) { return []; }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

export function importsOf(source, filename = "source.tsx") {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert.ok(ts.isStringLiteralLike(node.moduleSpecifier), "Static module specifier required");
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      assert.ok(node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]), "Computed runtime import cannot be audited");
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports;
}

export function isRetiredModule(path) {
  return /(?:^|\/)(?:lib\/(?:robots|world|mission-api)\/|components\/(?:workbench|world|unitree)\/)|mission-cockpit|@nemeia\/world-runtime|dockview/u.test(path);
}

/** Fail closed before any endpoint probe: inspect every app entry and transitive local import. */
export function assertNativeCutover() {
  const appFiles = files(join(frontendRoot, "app"));
  const handlers = appFiles.filter((file) => /\/route\.[cm]?[jt]sx?$/u.test(file)).map((file) => relative(frontendRoot, file)).toSorted();
  assert.deepEqual(handlers, nativeHandlers, "Only scoped immutable resource handlers may remain");
  for (const path of ["lib/server/mission-cockpit-runtime.ts", "lib/mission-api/cockpit.ts", "lib/world/robot-world-runtime.ts"]) {
    assert.equal(existsSync(join(frontendRoot, path)), false, `Retired state authority still exists: ${path}`);
  }
  const metadata = JSON.parse(readFileSync(join(frontendRoot, "package.json"), "utf8"));
  assert.equal(metadata.dependencies["@nemeia/world-runtime"], undefined);
  assert.equal(metadata.dependencies["@nemeia/world-client"], "file:../world-client");
  assert.equal(metadata.dependencies["@nemeia/world-resources"], "file:../world-resources");
  const config = readFileSync(join(frontendRoot, "next.config.mjs"), "utf8");
  assert.doesNotMatch(config, /@nemeia\/world-runtime|\b(?:rewrites|redirects)\s*[:(]/u, "No compatibility rewrites or legacy runtime package");
  const configFile = ts.readConfigFile(join(frontendRoot, "tsconfig.json"), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(configFile.config, ts.sys, frontendRoot);
  const pending = appFiles.filter((file) => /\.[cm]?[jt]sx?$/u.test(file));
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) { continue; }
    visited.add(file);
    const name = relative(frontendRoot, file);
    assert.equal(isRetiredModule(name), false, `App reaches retired module: ${name}`);
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /initializeRobotRuntime|useRobotRuntime|\/api\/(?:robots|mission\/cockpit)/u, `Legacy startup or API in ${name}`);
    for (const specifier of importsOf(source, file)) {
      assert.equal(isRetiredModule(specifier), false, `App reaches retired import: ${specifier}`);
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved) {
        assert.ok(!specifier.startsWith(".") || existsSync(resolve(dirname(file), specifier)), `Unresolved local import: ${specifier}`);
        continue;
      }
      const local = relative(frontendRoot, resolved);
      if (!local.startsWith("../") && !local.startsWith("node_modules/")) { pending.push(resolved); }
    }
  }
  return { handlers, modules: visited.size };
}

export async function verifyRetiredEndpoints(baseURL) {
  assertNativeCutover();
  const url = new URL(baseURL);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username + url.password, "");
  await Promise.all(retiredProbes.map(async ([method, path]) => {
    const response = await fetch(new URL(path, url.origin), { method, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    await response.body?.cancel();
    assert.equal(response.status, 404, `Retired ${method} ${path} must be absent`);
  }));
  return retiredProbes.length;
}
