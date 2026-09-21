import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(root, "..");

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Qualification builds must not clean the retained E7 development cache.
  distDir: process.env.NEMEIA_ISOLATED_UI === "1" ? ".next/e7"
    : process.env.NEMEIA_ISOLATED_BUILD === "1" ? ".next/qualification-build" : ".next",
  allowedDevOrigins: ["10.0.0.115", "100.65.89.47"],
  transpilePackages: ["@nemeia/world-client", "@nemeia/world-resources"],
  turbopack: {
    root: workspaceRoot
  }
};

export default nextConfig;
