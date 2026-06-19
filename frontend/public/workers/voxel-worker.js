class VoxelDecompressor {
  constructor(mod, decompressBufferSize) {
    this.mod = mod;
    this.input = mod._malloc(61440);
    this.decompressBuffer = mod._malloc(80000);
    this.positions = mod._malloc(2880000);
    this.uvs = mod._malloc(1920000);
    this.indices = mod._malloc(5760000);
    this.decompressedSize = mod._malloc(4);
    this.faceCount = mod._malloc(4);
    this.pointCount = mod._malloc(4);
    this.decompressBufferSize = decompressBufferSize;
  }

  generate(data, zNormalized) {
    this.mod.HEAPU8 = new Uint8Array(this.mod.memory.buffer);
    this.mod.HEAPU8.set(data, this.input);
    this.mod._generate(
      this.input,
      data.length,
      this.decompressBufferSize,
      this.decompressBuffer,
      this.decompressedSize,
      this.positions,
      this.uvs,
      this.indices,
      this.faceCount,
      this.pointCount,
      zNormalized
    );

    this.mod.HEAPU8 = new Uint8Array(this.mod.memory.buffer);

    const pointCount = this.mod.getValue(this.pointCount, "i32");
    const faceCount = this.mod.getValue(this.faceCount, "i32");
    const positions = new Uint8Array(this.mod.HEAPU8.subarray(this.positions, this.positions + faceCount * 12).slice());
    const uvs = new Uint8Array(this.mod.HEAPU8.subarray(this.uvs, this.uvs + faceCount * 8).slice());
    const indices = new Uint32Array(this.mod.HEAPU8.subarray(this.indices, this.indices + faceCount * 24).slice().buffer);

    return { point_count: pointCount, face_count: faceCount, positions, uvs, indices };
  }
}

let decompressor = null;

async function initWasm() {
  const response = await fetch("/libvoxel.wasm");
  const wasmBytes = await response.arrayBuffer();
  let wasmHeapU8 = null;
  const result = await WebAssembly.instantiate(wasmBytes, {
    a: {
      b: (dest, src, num) => {
        if (wasmHeapU8) {
          wasmHeapU8.copyWithin(dest, src, src + num);
        }
      },
      a: () => 0
    }
  });
  const exports = result.instance.exports;
  const wasmMemory = exports.c;
  wasmHeapU8 = new Uint8Array(wasmMemory.buffer);
  if (exports.d) {
    exports.d();
  }
  decompressor = new VoxelDecompressor(
    {
      _generate: exports.e,
      _malloc: exports.f,
      _free: exports.g,
      HEAPU8: wasmHeapU8,
      memory: wasmMemory,
      getValue: (ptr, type) => {
        const buffer = wasmMemory.buffer;
        if (type === "i32") {
          return new Int32Array(buffer)[ptr >> 2];
        }
        return new Int32Array(buffer)[ptr >> 2];
      }
    },
    80000
  );
  self.postMessage({ type: "ready" });
}

initWasm().catch((error) => {
  self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
});

self.addEventListener("message", (event) => {
  if (!decompressor) {
    return;
  }

  const frame = event.data;
  const rawData = frame?.data;
  if (!rawData) {
    return;
  }

  const data = new Uint8Array(rawData instanceof ArrayBuffer ? rawData : rawData.buffer || rawData);
  const resolution = Number(frame.resolution) || 0.1;
  const origin = Array.isArray(frame.origin) ? frame.origin : [0, 0, 0];
  const zNormalized = Math.floor(origin[2] / resolution);

  try {
    const geometryData = decompressor.generate(data, zNormalized);
    if (geometryData.face_count > 0) {
      self.postMessage(
        {
          type: "geometry",
          geometryData,
          resolution,
          origin
        },
        [geometryData.positions.buffer, geometryData.uvs.buffer, geometryData.indices.buffer]
      );
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
