import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoots = ["app", "src"];
const forbiddenFiles = ["index.html", "vite.config.ts", "src/main.tsx", "src/app.tsx"];
const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

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

for (const forbiddenFile of forbiddenFiles) {
  if (existsSync(path.join(root, forbiddenFile))) {
    failures.push(`${forbiddenFile}: Vite-era entrypoints are not allowed in the Next.js frontend.`);
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
    return "app";
  }

  if (relativePath.startsWith("src/app-shell/")) {
    return "app-shell";
  }

  if (relativePath.startsWith("src/route-pages/")) {
    return "route-pages";
  }

  if (relativePath.startsWith("src/components/ui/")) {
    return "ui";
  }

  if (relativePath.startsWith("src/features/")) {
    return "feature";
  }

  if (relativePath.startsWith("src/lib/")) {
    return "lib";
  }

  if (relativePath === "src/styles.css") {
    return "styles";
  }

  return "unknown";
};

const ensureBoundary = ({ from, fromLayer, to, toLayer }) => {
  if (toLayer === "unknown") {
    failures.push(`${from}: import to ${to} is outside the approved frontend folders.`);
    return;
  }

  if (fromLayer === "app" && !["app-shell", "route-pages", "styles"].includes(toLayer)) {
    failures.push(`${from}: app routes may only import app-shell, route-pages, or global styles (${to}).`);
  }

  if (fromLayer === "app-shell" && toLayer === "route-pages") {
    failures.push(`${from}: app-shell must not import route pages (${to}).`);
  }

  if (fromLayer === "route-pages" && ["app-shell", "ui"].includes(toLayer)) {
    failures.push(`${from}: route pages must stay thin and not import ${toLayer} directly (${to}).`);
  }

  if (fromLayer === "route-pages" && toLayer === "feature" && !to.startsWith("src/features/thread/")) {
    failures.push(`${from}: route pages may only compose thread features directly (${to}).`);
  }

  if (fromLayer === "ui" && !["ui", "lib"].includes(toLayer)) {
    failures.push(`${from}: UI primitives may only import UI primitives or lib utilities (${to}).`);
  }

  if (fromLayer === "feature" && ["app", "app-shell", "route-pages"].includes(toLayer)) {
    failures.push(`${from}: features must not import routes or shell code (${to}).`);
  }

  if (fromLayer === "lib" && !["lib"].includes(toLayer)) {
    failures.push(`${from}: lib modules must not import UI, features, routes, or shell code (${to}).`);
  }
};

for (const file of sourceFiles) {
  const relativeFile = normalize(path.relative(root, file));
  const fromLayer = classify(relativeFile);
  const source = readFileSync(file, "utf8");

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    const resolved = resolveLocalImport(file, specifier);

    if (!resolved) {
      continue;
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

if (failures.length > 0) {
  console.error("Frontend architecture check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Frontend architecture check passed for ${sourceFiles.length} source files.`);
