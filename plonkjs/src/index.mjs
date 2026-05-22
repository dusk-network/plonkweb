const DEFAULT_WASM_URL = new URL("../dist/plonkwasm.wasm", import.meta.url);
const DEFAULT_WASM_MODULE_URL = new URL("../dist/plonkwasm.js", import.meta.url);
const DEFAULT_WASM_THREAD_STACK_SIZE = 1 << 20;
const BYTE_TO_HEX = Array.from({ length: 256 }, (_, byte) =>
  byte.toString(16).padStart(2, "0")
);
const HEX_CHUNK_SIZE = 16 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let defaultPlonkJsPromise;

/**
 * Loads a circuit-specific plonkwasm artifact and exposes the JSON proof ABI.
 */
export class PlonkJs {
  static async load(options = {}) {
    const loadOptions = normalizeLoadOptions(options);

    if (loadOptions.modulePath) {
      return loadWasmBindgen(loadOptions);
    }

    const wasmBytes = await loadWasmBytes(loadOptions.wasmPath);
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    return new PlonkJs(instance);
  }

  constructor(instanceOrExports, options = {}) {
    this.exports = instanceOrExports.exports ?? instanceOrExports;
    this.memory = this.exports.memory;
    this.threadsEnabled = options.threadsEnabled === true;
    this.threadPoolSize = options.threadPoolSize ?? 0;

    for (const name of [
      "plonkweb_alloc",
      "plonkweb_free",
      "plonkweb_prove",
      "plonkweb_verify"
    ]) {
      if (typeof this.exports[name] !== "function") {
        throw new Error(`wasm export missing: ${name}`);
      }
    }
  }

  /**
   * Computes a proof using the loaded wasm artifact.
   *
   * `inputs` is forwarded to the circuit-specific wasm wrapper, so its shape is
   * defined by that wasm binary rather than by this JavaScript package.
   */
  async prove(proverKey, options = {}) {
    const seed = await normalizeSeed(options.seed);
    const inputs = normalizeInputs(options.inputs);

    if (typeof this.exports.plonkweb_prove_bytes === "function") {
      const binaryInputs = normalizeBinaryTestInputs(inputs);
      if (binaryInputs) {
        return this.#proveBytes(proverKey, seed, binaryInputs);
      }
    }

    const request = {
      prover_key_hex: extractHex(proverKey, "proverKey"),
      seed_hex: bytesToHex(seed),
      ...inputs
    };
    const response = this.#callJson("plonkweb_prove", request);
    return proofFromResponse(response);
  }

  /**
   * Verifies a proof using the loaded wasm artifact.
   */
  async verify(verifierKey, proof, publicInputs) {
    if (typeof this.exports.plonkweb_verify_bytes === "function") {
      const response = this.#verifyBytes(verifierKey, proof, publicInputs);
      return response.verified === true;
    }

    const response = this.#callJson("plonkweb_verify", {
      verifier_key_hex: extractHex(verifierKey, "verifierKey"),
      proof_hex: extractHex(proof, "proof"),
      public_inputs_hex: extractHex(publicInputs, "publicInputs")
    });

    return response.verified === true;
  }

  #proveBytes(proverKey, seed, inputs) {
    const proverKeyBytes = extractBytes(proverKey, "proverKey");
    const proverKeyAllocation = this.#allocBytes(proverKeyBytes);
    const seedAllocation = this.#allocBytes(seed);

    try {
      const response = this.#decodePackedResponse(
        this.exports.plonkweb_prove_bytes(
          proverKeyAllocation.ptr,
          proverKeyAllocation.len,
          seedAllocation.ptr,
          seedAllocation.len,
          BigInt(inputs.left),
          BigInt(inputs.right)
        )
      );
      return proofFromResponse(response);
    } finally {
      this.exports.plonkweb_free(proverKeyAllocation.ptr, proverKeyAllocation.len);
      this.exports.plonkweb_free(seedAllocation.ptr, seedAllocation.len);
    }
  }

  #verifyBytes(verifierKey, proof, publicInputs) {
    const verifierKeyAllocation = this.#allocBytes(extractBytes(verifierKey, "verifierKey"));
    const proofAllocation = this.#allocBytes(extractBytes(proof, "proof"));
    const publicInputsAllocation = this.#allocBytes(
      extractBytes(publicInputs, "publicInputs")
    );

    try {
      return this.#decodePackedResponse(
        this.exports.plonkweb_verify_bytes(
          verifierKeyAllocation.ptr,
          verifierKeyAllocation.len,
          proofAllocation.ptr,
          proofAllocation.len,
          publicInputsAllocation.ptr,
          publicInputsAllocation.len
        )
      );
    } finally {
      this.exports.plonkweb_free(verifierKeyAllocation.ptr, verifierKeyAllocation.len);
      this.exports.plonkweb_free(proofAllocation.ptr, proofAllocation.len);
      this.exports.plonkweb_free(publicInputsAllocation.ptr, publicInputsAllocation.len);
    }
  }

  #callJson(exportName, request) {
    const requestBytes = textEncoder.encode(JSON.stringify(request));
    const requestAllocation = this.#allocBytes(requestBytes);

    let packed;
    try {
      packed = this.exports[exportName](requestAllocation.ptr, requestAllocation.len);
    } finally {
      this.exports.plonkweb_free(requestAllocation.ptr, requestAllocation.len);
    }

    return this.#decodePackedResponse(packed);
  }

  #decodePackedResponse(packed) {
    packed = BigInt(packed);
    const responsePtr = Number(packed >> 32n);
    const responseLen = Number(packed & 0xffffffffn);
    const responseBytes = new Uint8Array(
      this.memory.buffer,
      responsePtr,
      responseLen
    );
    const responseJson = textDecoder.decode(copyIfShared(responseBytes));
    this.exports.plonkweb_free(responsePtr, responseLen);

    const response = JSON.parse(responseJson);
    if (!response.ok) {
      throw new Error(response.error ?? "wasm call failed");
    }

    return response.result;
  }

  #allocBytes(bytes) {
    const ptr = this.exports.plonkweb_alloc(bytes.length);
    new Uint8Array(this.memory.buffer, ptr, bytes.length).set(bytes);
    return { ptr, len: bytes.length };
  }
}

export async function loadPlonkJs(options = {}) {
  return PlonkJs.load(options);
}

export async function prove(proverKey, options = {}) {
  const plonkjs = await getDefaultPlonkJs(options);
  return plonkjs.prove(proverKey, options);
}

export async function verify(verifierKey, proof, publicInputs, options = {}) {
  const plonkjs = await getDefaultPlonkJs(options);
  return plonkjs.verify(verifierKey, proof, publicInputs);
}

export function bytesToHex(bytes) {
  if (typeof bytes === "string") {
    return normalizeHex(bytes, "bytes");
  }
  if (bytes && typeof bytes.bytesHex === "string") {
    return normalizeHex(bytes.bytesHex, "bytesHex");
  }

  const source = extractBytes(bytes, "bytes");
  if (source.length === 0) {
    return "";
  }

  const chunks = [];
  for (let offset = 0; offset < source.length; offset += HEX_CHUNK_SIZE) {
    const end = Math.min(offset + HEX_CHUNK_SIZE, source.length);
    const chunk = new Array(end - offset);
    for (let index = offset; index < end; index += 1) {
      chunk[index - offset] = BYTE_TO_HEX[source[index]];
    }
    chunks.push(chunk.join(""));
  }
  return chunks.join("");
}

export function hexToBytes(hex) {
  const normalized = normalizeHex(hex, "hex");

  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] =
      (decodeHexNibble(normalized.charCodeAt(i * 2)) << 4) |
      decodeHexNibble(normalized.charCodeAt(i * 2 + 1));
  }
  return bytes;
}

async function getDefaultPlonkJs(options) {
  if (hasCustomLoadOptions(options)) {
    return PlonkJs.load(options);
  }

  defaultPlonkJsPromise ??= PlonkJs.load();
  return defaultPlonkJsPromise;
}

async function loadWasmBindgen(options) {
  const moduleUrl = toUrl(options.modulePath);
  const shouldInitThreads = options.threads !== false;

  if (shouldInitThreads) {
    assertBrowserThreadsAvailable();
  }

  const wasmModule = await import(moduleUrl.href);
  const wasmPath = options.bindgenWasmPath ?? new URL("plonkwasm_bg.wasm", moduleUrl);
  const wasmBytes = await loadWasmBytes(wasmPath);
  const wasmExports = await wasmModule.default({
    module_or_path: wasmBytes,
    thread_stack_size: normalizeThreadStackSize(options.threadStackSize)
  });
  let threadPoolSize = 0;

  if (shouldInitThreads) {
    if (typeof wasmModule.initThreadPool !== "function") {
      throw new Error("wasm-bindgen module does not export initThreadPool");
    }

    threadPoolSize = normalizeThreadPoolSize(options.threadPoolSize);
    await wasmModule.initThreadPool(threadPoolSize);
  }

  return new PlonkJs(wasmExports, {
    threadsEnabled: shouldInitThreads,
    threadPoolSize
  });
}

async function loadWasmBytes(wasmPath) {
  const url = toUrl(wasmPath);
  if (url.protocol === "file:" && isNodeRuntime()) {
    const [{ readFile }, { fileURLToPath }] = await Promise.all([
      import("node:fs/promises"),
      import("node:url")
    ]);
    return readFile(fileURLToPath(url));
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch wasm: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function normalizeLoadOptions(options) {
  if (options instanceof URL || typeof options === "string") {
    return { wasmPath: options };
  }
  if (options == null) {
    return { wasmPath: DEFAULT_WASM_URL };
  }
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new Error("load options must be an object, URL, or string");
  }

  if (
    options.modulePath ||
    options.bindgenWasmPath ||
    options.threads != null ||
    options.threadPoolSize != null
  ) {
    return {
      modulePath: options.modulePath ?? DEFAULT_WASM_MODULE_URL,
      bindgenWasmPath: options.bindgenWasmPath,
      threads: options.threads,
      threadPoolSize: options.threadPoolSize,
      threadStackSize: options.threadStackSize
    };
  }

  return {
    wasmPath: options.wasmPath ?? DEFAULT_WASM_URL
  };
}

function hasCustomLoadOptions(options) {
  return Boolean(
    options?.wasmPath ||
      options?.modulePath ||
      options?.bindgenWasmPath ||
      options?.threads != null ||
      options?.threadPoolSize != null ||
      options?.threadStackSize != null
  );
}

function normalizeThreadPoolSize(threadPoolSize) {
  const size = threadPoolSize ?? globalThis.navigator?.hardwareConcurrency ?? 1;
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("threadPoolSize must be a positive integer");
  }
  return size;
}

function normalizeThreadStackSize(threadStackSize) {
  const size = threadStackSize ?? DEFAULT_WASM_THREAD_STACK_SIZE;
  if (!Number.isSafeInteger(size) || size <= 0 || size % 65536 !== 0) {
    throw new Error("threadStackSize must be a positive multiple of 65536");
  }
  return size;
}

function assertBrowserThreadsAvailable() {
  if (isNodeRuntime()) {
    throw new Error("wasm rayon thread pools are only supported by the browser loader");
  }
  if (typeof Worker !== "function" || typeof SharedArrayBuffer !== "function") {
    throw new Error("wasm threads require Worker and SharedArrayBuffer support");
  }
  if (globalThis.crossOriginIsolated !== true) {
    throw new Error(
      "wasm threads require cross-origin isolation. Serve the example with COOP/COEP headers, for example `make serve-example`."
    );
  }
}

function toUrl(value) {
  return value instanceof URL ? value : new URL(value, import.meta.url);
}

async function normalizeSeed(seed) {
  if (seed == null) {
    const bytes = new Uint8Array(32);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    }

    const { randomBytes } = await import("node:crypto");
    bytes.set(randomBytes(32));
    return bytes;
  }

  const bytes = extractBytes(seed, "seed");
  if (bytes.length !== 32) {
    throw new Error(`seed must be 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

function extractBytes(value, name) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === "string") {
    return hexToBytes(value);
  }
  if (value && value[name] instanceof Uint8Array) {
    return value[name];
  }
  if (value && typeof value[`${name}Hex`] === "string") {
    return hexToBytes(value[`${name}Hex`]);
  }
  throw new Error(`${name} must be a Uint8Array or hex string`);
}

function extractHex(value, name) {
  if (typeof value === "string") {
    return normalizeHex(value, name);
  }
  if (value && typeof value[`${name}Hex`] === "string") {
    return normalizeHex(value[`${name}Hex`], `${name}Hex`);
  }
  return bytesToHex(extractBytes(value, name));
}

function normalizeHex(hex, name) {
  if (typeof hex !== "string") {
    throw new Error(`${name} must be a hex string`);
  }
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new Error(`${name} hex string must have even length`);
  }
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    const isHex =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 70) ||
      (code >= 97 && code <= 102);
    if (!isHex) {
      throw new Error(`${name} hex string contains an invalid character`);
    }
  }
  return normalized;
}

function decodeHexNibble(code) {
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  if (code >= 65 && code <= 70) {
    return code - 55;
  }
  if (code >= 97 && code <= 102) {
    return code - 87;
  }
  throw new Error("hex string contains an invalid character");
}

function copyIfShared(bytes) {
  if (typeof SharedArrayBuffer !== "undefined" && bytes.buffer instanceof SharedArrayBuffer) {
    return bytes.slice();
  }
  return bytes;
}

function normalizeInputs(inputs) {
  if (inputs == null) {
    return {};
  }
  if (typeof inputs !== "object" || Array.isArray(inputs)) {
    throw new Error("inputs must be an object");
  }
  return inputs;
}

function normalizeBinaryTestInputs(inputs) {
  const keys = Object.keys(inputs);
  if (keys.some((key) => key !== "left" && key !== "right")) {
    return null;
  }

  const left = inputs.left;
  const right = inputs.right;
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0
  ) {
    return null;
  }

  return { left, right };
}

function proofFromResponse(response) {
  return {
    proof: hexToBytes(response.proof_hex),
    publicInputs: hexToBytes(response.public_inputs_hex),
    proofHex: response.proof_hex,
    publicInputsHex: response.public_inputs_hex
  };
}

function isNodeRuntime() {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}
