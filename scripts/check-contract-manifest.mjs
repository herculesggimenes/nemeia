import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { requiredEvidence } from "../conformance/src/qualification-report.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const manifestPath = resolve(root, "conformance/contract-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const expectedTables = [
  "world_config", "member", "entity", "pose", "geometry", "semantic", "relation",
  "observation", "track", "action_binding", "unit_control", "mission",
  "mission_objective_progress", "agent", "mission_agent", "unit_assignment",
  "agent_message", "execution", "world_event", "spatial_frame", "local_map", "map_revision"
];
const expectedBoundaries = [
  "WorldMemory", "Missions", "WorldOperators", "AgentCoordination", "PerceptionIngress",
  "ActionRequests", "ExecutionClaims", "Cancellation", "ControlFeedback",
  "ExecutionCompletion", "WorldAdministration", "LocalController", "EvidenceStorage"
];

const errors = [];
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const sameSet = (actual, expected) => same([...actual].sort(), [...expected].sort());
for (const [gate, checks] of Object.entries(requiredEvidence)) {
  if (!sameSet(manifest.qualification?.[gate]?.requires ?? [], checks)) errors.push(`${gate} required checks drifted from the report guard`);
}
if (manifest.manifestVersion !== 1) errors.push("manifestVersion must be 1");
if (manifest.authority !== "docs/protocol-spacetimedb.md") errors.push("authority must be the SpacetimeDB protocol");
if (!same(manifest.world?.tables, expectedTables)) errors.push("world.tables drifted from the selected 22-table inventory");
if (!same(manifest.world?.contractBoundaries, expectedBoundaries)) errors.push("contractBoundaries drifted from the selected 13 boundaries");
if (manifest.world?.tables?.some(table => manifest.world.forbiddenHierarchy.some(term => table.includes(term)))) {
  errors.push("world.tables contains a room/region/annotation hierarchy");
}
if (manifest.world?.tables?.some(table => manifest.world.forbiddenTables.includes(table))) {
  errors.push("world.tables contains a forbidden agent-managed subscription table");
}
if (!same(manifest.sharedShapes?.ResourceRef, ["id", "schema", "sha256", "byteLength"])) {
  errors.push("ResourceRef must use the shared lossless id/schema/sha256/byteLength shape");
}

if (process.argv.includes("--strict")) {
  const schemaPath = resolve(root, "contracts/spacetimedb/src/schema.ts");
  if (!existsSync(schemaPath)) throw new Error("canonical World-owned module schema is missing");
  const source = readFileSync(schemaPath, "utf8");
  const tsModule = await import("typescript");
  const ts = tsModule.default ?? tsModule;
  const sourceFile = ts.createSourceFile(schemaPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tableDeclarations = new Map();
  let schemaObject;
  function visit(node) {
    if (ts.isVariableStatement(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (declaration.name.getText(sourceFile) === "db" && initializer && ts.isCallExpression(initializer) && initializer.expression.getText(sourceFile) === "schema") {
          schemaObject = initializer.arguments[0];
        }
        if (!initializer || !ts.isCallExpression(initializer) || initializer.expression.getText(sourceFile) !== "table") continue;
        const config = initializer.arguments[0];
        if (!config || !ts.isObjectLiteralExpression(config)) continue;
        const nameProperty = config.properties.find(property => property.name?.getText(sourceFile) === "name");
        if (nameProperty?.initializer && ts.isStringLiteral(nameProperty.initializer)) tableDeclarations.set(declaration.name.getText(sourceFile), nameProperty.initializer.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!schemaObject || !ts.isObjectLiteralExpression(schemaObject)) throw new Error("canonical exported db schema has no static table object");
  const actualTables = schemaObject.properties.map(property => {
    const identifier = ts.isShorthandPropertyAssignment(property) ? property.name.getText(sourceFile)
      : ts.isPropertyAssignment(property) ? property.initializer.getText(sourceFile) : undefined;
    const tableName = tableDeclarations.get(identifier);
    if (!tableName) throw new Error(`db schema references an unresolved table: ${identifier ?? property.getText(sourceFile)}`);
    return tableName;
  });
  if (!sameSet(actualTables, expectedTables)) {
    errors.push(`exported db schema has ${actualTables.length} tables; strict target comparison requires the World-owned 22-table schema`);
  }
}

if (errors.length) {
  console.error(errors.map(error => `contract-manifest: ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`contract-manifest: ${manifest.world.tables.length} target tables, ${manifest.world.contractBoundaries.length} boundaries, ResourceRef byteLength required`);
}
