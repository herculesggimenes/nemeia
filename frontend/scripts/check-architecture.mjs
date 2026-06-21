import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoots = ["app", "components", "lib", "types"];
const forbiddenPaths = [
  "index.html",
  "vite.config.ts",
  "src",
  "src/main.tsx",
  "src/app.tsx",
  "src/app-shell",
  "src/features",
  "src/route-pages",
  "src/styles.css"
];
const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const classNamePattern = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|{`([^`]*)`})/g;
const rawInteractivePattern = /<(button|textarea|input)\b/g;
const maxSourceLines = 350;
const oversizedFileAllowlist = new Set([
  "components/layout/app-shell.tsx",
  "components/unitree/go2-connection-config-panel.tsx",
  "components/unitree/unitree-point-cloud-view.tsx",
  "lib/robots/unitree/go2-store.ts",
  "lib/robots/unitree/go2-webrtc.ts"
]);
const componentForbiddenImports = [
  {
    pattern: /(?:^|\/)go2-topics$/,
    reason: "components should call Nemeia-level Go2 actions, not raw Unitree topic constants"
  },
  {
    pattern: /(?:^|\/)go2-webrtc$/,
    reason: "components should use the Go2 store/provider boundary, not transport primitives"
  }
];
const legacyStyleTokens = [
  "appMain",
  "artifactDrawer",
  "artifactResizeHandle",
  "artifactSurface",
  "controlGrid",
  "controlMock",
  "metrics",
  "mobileThreadHeader",
  "promptActions",
  "promptBox",
  "robotCard",
  "robotGlyph",
  "settingsBlank",
  "stopButton",
  "threadList",
  "unitree"
];

const failures = [];

const normalize = (filePath) => filePath.split(path.sep).join("/");

const isSourceFile = (filePath) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);

const walk = (dir) => {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      return walk(fullPath);
    }

    return isSourceFile(fullPath) ? [fullPath] : [];
  });
};

const sourceFiles = sourceRoots.flatMap((dir) => walk(path.join(root, dir)));

for (const forbiddenPath of forbiddenPaths) {
  if (existsSync(path.join(root, forbiddenPath))) {
    failures.push(`${forbiddenPath}: frontend follows the Nemeia app/components/lib/types layout; this path is not allowed.`);
  }
}

const rootEntries = readdirSync(root, { withFileTypes: true });
const allowedTopLevelSourceDirs = new Set([
  ".next",
  ".swc",
  "app",
  "components",
  "dist",
  "lib",
  "node_modules",
  "public",
  "scripts",
  "test-results",
  "tests",
  "types"
]);

for (const entry of rootEntries) {
  if (!entry.isDirectory()) {
    continue;
  }

  if (!allowedTopLevelSourceDirs.has(entry.name) && !entry.name.startsWith(".")) {
    failures.push(`${entry.name}/: top-level frontend folders must match Nemeia's app/components/lib/types split.`);
  }
}

const resolveLocalImport = (fromFile, specifier) => {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const absolute = path.resolve(path.dirname(fromFile), specifier);
  const relative = normalize(path.relative(root, absolute));

  if (relative.startsWith("../")) {
    return { relative, outsideFrontend: true };
  }

  return { relative, outsideFrontend: false };
};

const classify = (relativePath) => {
  if (relativePath.startsWith("app/")) {
    return relativePath === "app/globals.css" ? "styles" : "app";
  }

  if (relativePath.startsWith("components/ui/")) {
    return "ui";
  }

  if (relativePath.startsWith("components/")) {
    return "components";
  }

  if (relativePath.startsWith("lib/")) {
    return "lib";
  }

  if (relativePath.startsWith("types/")) {
    return "types";
  }

  return "unknown";
};

const allowedImportsByLayer = {
  app: new Set(["app", "components", "ui", "lib", "types", "styles"]),
  components: new Set(["components", "ui", "lib", "types"]),
  ui: new Set(["ui", "lib", "types"]),
  lib: new Set(["lib", "types"]),
  types: new Set(["types"]),
  styles: new Set(["styles"])
};

const ensureBoundary = ({ from, fromLayer, to, toLayer }) => {
  if (toLayer === "unknown") {
    failures.push(`${from}: import to ${to} is outside the approved Nemeia frontend folders.`);
    return;
  }

  const allowedTargets = allowedImportsByLayer[fromLayer];
  if (!allowedTargets) {
    failures.push(`${from}: file is outside the approved app/components/lib/types layers.`);
    return;
  }

  if (!allowedTargets.has(toLayer)) {
    failures.push(`${from}: ${fromLayer} code must not import ${toLayer} code (${to}).`);
  }
};

for (const file of sourceFiles) {
  const relativeFile = normalize(path.relative(root, file));
  const fromLayer = classify(relativeFile);
  const source = readFileSync(file, "utf8");
  const lineCount = source.split("\n").length;

  if (fromLayer === "unknown") {
    failures.push(`${relativeFile}: source files must live under app/, components/, lib/, or types/.`);
  }

  if (lineCount > maxSourceLines && !oversizedFileAllowlist.has(relativeFile)) {
    failures.push(
      `${relativeFile}: ${lineCount} lines exceeds the ${maxSourceLines}-line module budget; split orchestration, UI, and protocol code.`
    );
  }

  for (const classNameMatch of source.matchAll(classNamePattern)) {
    const classNameSource = classNameMatch[1] ?? classNameMatch[2] ?? classNameMatch[3] ?? "";
    for (const token of legacyStyleTokens) {
      if (classNameSource.includes(token)) {
        failures.push(`${relativeFile}: legacy custom CSS class token "${token}" is not allowed; use Tailwind utilities and data-testid.`);
      }
    }
  }

  if (!relativeFile.startsWith("components/ui/")) {
    for (const rawInteractiveMatch of source.matchAll(rawInteractivePattern)) {
      failures.push(
        `${relativeFile}: raw <${rawInteractiveMatch[1]}> is not allowed outside components/ui; use the shadcn UI primitive.`
      );
    }
  }

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    const resolved = resolveLocalImport(file, specifier);

    if (!resolved) {
      if (relativeFile.startsWith("components/")) {
        for (const forbiddenImport of componentForbiddenImports) {
          if (forbiddenImport.pattern.test(specifier)) {
            failures.push(`${relativeFile}: ${forbiddenImport.reason} (${specifier}).`);
          }
        }
      }

      continue;
    }

    if (relativeFile.startsWith("components/")) {
      for (const forbiddenImport of componentForbiddenImports) {
        if (forbiddenImport.pattern.test(resolved.relative)) {
          failures.push(`${relativeFile}: ${forbiddenImport.reason} (${specifier}).`);
        }
      }
    }

    if (resolved.outsideFrontend) {
      failures.push(`${relativeFile}: relative import escapes the frontend root (${specifier}).`);
      continue;
    }

    ensureBoundary({
      from: relativeFile,
      fromLayer,
      to: resolved.relative,
      toLayer: classify(resolved.relative)
    });
  }
}

const globalCssPath = path.join(root, "app/globals.css");
if (existsSync(globalCssPath)) {
  const globalCss = readFileSync(globalCssPath, "utf8");
  const classSelectorPattern = /(^|[{};,]\s*)\.[A-Za-z_-][\w-]*/gm;
  const matches = Array.from(globalCss.matchAll(classSelectorPattern));

  if (matches.length > 0) {
    const selectors = matches.map((match) => match[0].trim()).join(", ");
    failures.push(`app/globals.css: custom class selectors are not allowed (${selectors}); use Tailwind @theme/@utility or component utilities.`);
  }
}

if (failures.length > 0) {
  console.error("Frontend architecture check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Frontend architecture check passed for ${sourceFiles.length} source files.`);
