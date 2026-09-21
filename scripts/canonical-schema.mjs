import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(new URL("..", import.meta.url).pathname);

function parse(relativePath) {
  const path = resolve(root, relativePath);
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function exportedVariables(source) {
  return source.statements.filter((node) => ts.isVariableStatement(node) &&
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap((statement) => statement.declarationList.declarations.map((declaration) => ({ statement, declaration })));
}

export function canonicalSchemaTables() {
  const source = parse("contracts/spacetimedb/src/schema.ts");
  const declarations = new Map();
  let registered;
  for (const { declaration } of exportedVariables(source)) {
    const call = declaration.initializer;
    if (!call || !ts.isCallExpression(call)) continue;
    const accessor = declaration.name.getText(source);
    if (accessor === "db" && call.expression.getText(source) === "schema") registered = call.arguments[0];
    if (call.expression.getText(source) !== "table") continue;
    const [config, row] = call.arguments;
    if (!config || !row || !ts.isObjectLiteralExpression(config) || !ts.isObjectLiteralExpression(row)) {
      throw new Error(`unsupported canonical table declaration: ${accessor}`);
    }
    const name = config.properties.find((property) => property.name?.getText(source) === "name")?.initializer;
    if (!name || !ts.isStringLiteral(name)) throw new Error(`canonical table name is not static: ${accessor}`);
    const columns = row.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) throw new Error(`unsupported canonical column: ${name.text}`);
      const builder = property.initializer.getText(source);
      const constraints = [...builder.matchAll(/\.(primaryKey|unique|autoInc|index)\([^)]*\)/g)]
        .map((match) => ({ primaryKey: "primary key", unique: "unique", autoInc: "auto-increment", index: "indexed" })[match[1]]);
      const type = builder.replace(/\.(primaryKey|unique|autoInc|index)\([^)]*\)/g, "");
      return [property.name.getText(source), type, constraints.join(", ") || "Canonical SDK field"];
    });
    declarations.set(accessor, { accessor, name: name.text, columns });
  }
  if (!registered || !ts.isObjectLiteralExpression(registered)) throw new Error("canonical exported db schema is missing");
  return registered.properties.map((property) => {
    const accessor = ts.isShorthandPropertyAssignment(property) ? property.name.getText(source)
      : ts.isPropertyAssignment(property) ? property.initializer.getText(source) : undefined;
    const table = declarations.get(accessor);
    if (!table) throw new Error(`unresolved canonical schema table: ${accessor}`);
    return table;
  });
}

export function canonicalDeclarations(relativePath, names) {
  const source = parse(relativePath);
  const exported = new Map(exportedVariables(source).map(({ declaration, statement }) => [declaration.name.getText(source), statement.getText(source)]));
  return `// Generated reference from ${relativePath}\n` + names.map((name) => {
    const code = exported.get(name);
    if (!code) throw new Error(`missing canonical export ${name} in ${relativePath}`);
    return code;
  }).join("\n\n");
}
