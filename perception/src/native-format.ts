import { NATIVE_SCHEMAS } from "./types.ts";

/** Synthetic formats are standards-shaped fixtures, not vendor recordings. */
export const SUPPORTED_SYNTHETIC_SCHEMAS = new Set([
  "image/png",
  "text/x.pcd",
  "application/json",
]);

/** Known-valid 1x1 grayscale+alpha PNG, exported for offline integration fixtures. */
export const SYNTHETIC_PNG_1X1 = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2,
  0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248, 15, 0,
  1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

/** Second valid PNG variant used only to prove duplicate-content conflicts. */
export const SYNTHETIC_PNG_1X1_RGB = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2,
  0, 0, 0, 18, 116, 69, 88, 116, 110, 101, 109, 101, 105, 97,
  0, 118, 97, 114, 105, 97, 110, 116, 45, 114, 103, 98, 208, 221,
  186, 251, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248,
  15, 0, 1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69,
  78, 68, 174, 66, 96, 130,
]);

/** Standards-shaped ASCII PCD fixture for synthetic map tests. */
export const SYNTHETIC_PCD_ASCII = `# .PCD v0.7 - Point Cloud Data file format
VERSION 0.7
FIELDS x y z
SIZE 4 4 4
TYPE F F F
COUNT 1 1 1
WIDTH 2
HEIGHT 1
VIEWPOINT 0 0 0 1 0 0 0
POINTS 2
DATA ascii
0 0 0
1 0 0
`;

/** Explicit int8 occupancy-grid JSON fixture; the bytes are application/json. */
export const SYNTHETIC_OCCUPANCY_GRID_JSON = JSON.stringify({
  format: "nav_msgs/OccupancyGrid",
  encoding: "int8",
  resolution: 0.05,
  width: 2,
  height: 2,
  origin: { x: 0, y: 0, z: 0, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  data: [0, 100, -1, 0],
});

function validatePng(bytes: Uint8Array): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 33 || !signature.every((value, index) => bytes[index] === value)) throw new Error("png_signature_invalid");
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const length = view.getUint32(0, false);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.byteLength) throw new Error("png_chunk_truncated");
    if (type === "IHDR") {
      if (sawHeader || length !== 13) throw new Error("png_header_invalid");
      const header = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 13);
      const width = header.getUint32(0, false);
      const height = header.getUint32(4, false);
      const bitDepth = header.getUint8(8);
      const colorType = header.getUint8(9);
      if (width === 0 || height === 0 || width > 8192 || height > 8192 || bitDepth !== 8 || ![0, 2, 3, 4, 6].includes(colorType)) throw new Error("png_dimensions_or_encoding_invalid");
      sawHeader = true;
    } else if (type === "IDAT") {
      if (!sawHeader || length === 0) throw new Error("png_data_invalid");
      sawData = true;
    } else if (type === "IEND") {
      if (length !== 0 || !sawHeader || !sawData || chunkEnd !== bytes.byteLength) throw new Error("png_end_invalid");
      sawEnd = true;
      break;
    }
    offset = chunkEnd;
  }
  if (!sawEnd) throw new Error("png_end_missing");
}

function validatePcd(bytes: Uint8Array): void {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("pcd_utf8_invalid");
  }
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const values = new Map<string, string>();
  let dataIndex = -1;
  for (const [index, line] of lines.entries()) {
    if (line.startsWith("#")) continue;
    const [key, ...rest] = line.split(/\s+/u);
    if (key === "DATA") {
      if (rest.length !== 1 || rest[0] !== "ascii") throw new Error("pcd_data_encoding_unsupported");
      dataIndex = index;
      break;
    }
    if (key && rest.length) values.set(key, rest.join(" "));
  }
  if (values.get("VERSION") !== "0.7" || values.get("FIELDS") !== "x y z" || values.get("SIZE") !== "4 4 4" || values.get("TYPE") !== "F F F" || values.get("COUNT") !== "1 1 1") throw new Error("pcd_header_invalid");
  const width = Number(values.get("WIDTH"));
  const height = Number(values.get("HEIGHT"));
  const points = Number(values.get("POINTS"));
  if (!Number.isSafeInteger(width) || width <= 0 || height !== 1 || points !== width || dataIndex < 0) throw new Error("pcd_dimensions_invalid");
  const rows = lines.slice(dataIndex + 1);
  if (rows.length !== points || rows.some((row) => row.split(/\s+/u).length !== 3 || row.split(/\s+/u).some((value) => !Number.isFinite(Number(value))))) throw new Error("pcd_points_invalid");
}

function validateOccupancyGridJson(bytes: Uint8Array): void {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("occupancy_grid_json_invalid");
  }
  if (!value || typeof value !== "object") throw new Error("occupancy_grid_json_invalid");
  const grid = value as Record<string, unknown>;
  const width = grid.width;
  const height = grid.height;
  if (typeof width !== "number" || typeof height !== "number") throw new Error("occupancy_grid_header_invalid");
  if (grid.format !== "nav_msgs/OccupancyGrid" || grid.encoding !== "int8" || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !Number.isFinite(grid.resolution) || (grid.resolution as number) <= 0 || !Array.isArray(grid.data) || grid.data.length !== width * height) throw new Error("occupancy_grid_header_invalid");
  if (grid.data.some((entry) => !Number.isInteger(entry) || (entry as number) < -1 || (entry as number) > 100)) throw new Error("occupancy_grid_data_invalid");
}

/**
 * Validates supported bytes before replay/checkpoint publication. Real
 * ROS/Unitree serialized recordings are deliberately rejected until a native
 * decoder is qualified; synthetic tests use the standard representation that
 * matches the stored MIME/schema bytes.
 */
export function validateSupportedNativeFormat(bytes: Uint8Array, schema: string, fixtureKind: "recorded" | "synthetic"): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error("native_bytes_required");
  if (fixtureKind !== "synthetic") throw new Error("recorded_native_format_unqualified");
  if (!SUPPORTED_SYNTHETIC_SCHEMAS.has(schema)) {
    if (NATIVE_SCHEMAS.has(schema)) throw new Error("vendor_native_format_unqualified");
    throw new Error(`unsupported_native_schema:${schema}`);
  }
  if (schema === "image/png") validatePng(bytes);
  else if (schema === "text/x.pcd") validatePcd(bytes);
  else validateOccupancyGridJson(bytes);
}
