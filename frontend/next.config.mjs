import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import("next").NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["10.0.0.115", "100.65.89.47"],
  turbopack: {
    root
  }
};

export default nextConfig;
