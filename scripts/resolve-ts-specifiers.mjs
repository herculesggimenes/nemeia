import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

async function isFile(pathname) {
  try {
    await access(pathname, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve extensionless relative imports emitted by the generated client.
 * This is a test-loader compatibility shim only; it does not rewrite source
 * files or alter the generated bindings used by the runtime composition.
 */
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && (specifier.startsWith("./") || specifier.startsWith("../")) && !extname(specifier)) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    for (const extension of SOURCE_EXTENSIONS) {
      const candidate = `${base}${extension}`;
      if (await isFile(candidate)) return nextResolve(pathToFileURL(candidate).href, context, nextResolve);
    }
  }
  return nextResolve(specifier, context, nextResolve);
}
