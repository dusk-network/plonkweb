const DEFAULT_WASM_URL = new URL("../dist/plonkwasm.wasm", import.meta.url);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let defaultSdkPromise;

/**
 * Loads a circuit-specific plonkwasm artifact and exposes the JSON proof ABI.
 */
export class PlonkJs {
  static async load(wasmPath = DEFAULT_WASM_URL) {
    const wasmBytes = await loadWasmBytes(wasmPath);
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    return new PlonkJs(instance);
  }

  constructor(instance) {
    this.exports = instance.exports;
    this.memory = this.exports.memory;

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
    const request = {
      prover_key_hex: bytesToHex(extractBytes(proverKey, "proverKey")),
      seed_hex: bytesToHex(seed),
      ...normalizeInputs(options.inputs)
    };

    const response = this.#callJson("plonkweb_prove", request);
    return {
      proof: hexToBytes(response.proof_hex),
      publicInputs: hexToBytes(response.public_inputs_hex),
      proofHex: response.proof_hex,
      publicInputsHex: response.public_inputs_hex
    };
  }

  /**
   * Verifies a proof using the loaded wasm artifact.
   */
  async verify(verifierKey, proof, publicInputs) {
    const response = this.#callJson("plonkweb_verify", {
      verifier_key_hex: bytesToHex(extractBytes(verifierKey, "verifierKey")),
      proof_hex: bytesToHex(extractBytes(proof, "proof")),
      public_inputs_hex: bytesToHex(extractBytes(publicInputs, "publicInputs"))
    });

    return response.verified === true;
  }

  #callJson(exportName, request) {
    const requestBytes = textEncoder.encode(JSON.stringify(request));
    const requestPtr = this.exports.plonkweb_alloc(requestBytes.length);
    new Uint8Array(this.memory.buffer, requestPtr, requestBytes.length).set(
      requestBytes
    );

    const packed = BigInt(this.exports[exportName](requestPtr, requestBytes.length));
    this.exports.plonkweb_free(requestPtr, requestBytes.length);

    const responsePtr = Number(packed >> 32n);
    const responseLen = Number(packed & 0xffffffffn);
    const responseBytes = new Uint8Array(
      this.memory.buffer,
      responsePtr,
      responseLen
    ).slice();
    this.exports.plonkweb_free(responsePtr, responseLen);

    const response = JSON.parse(textDecoder.decode(responseBytes));
    if (!response.ok) {
      throw new Error(response.error ?? "wasm call failed");
    }

    return response.result;
  }
}

export async function loadPlonkJs(options = {}) {
  return PlonkJs.load(options.wasmPath);
}

export async function prove(proverKey, options = {}) {
  const sdk = await getDefaultSdk(options.wasmPath);
  return sdk.prove(proverKey, options);
}

export async function verify(verifierKey, proof, publicInputs, options = {}) {
  const sdk = await getDefaultSdk(options.wasmPath);
  return sdk.verify(verifierKey, proof, publicInputs);
}

export function bytesToHex(bytes) {
  return Array.from(extractBytes(bytes, "bytes"), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function hexToBytes(hex) {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function getDefaultSdk(wasmPath) {
  if (wasmPath) {
    return PlonkJs.load(wasmPath);
  }

  defaultSdkPromise ??= PlonkJs.load();
  return defaultSdkPromise;
}

async function loadWasmBytes(wasmPath) {
  const url = wasmPath instanceof URL ? wasmPath : new URL(wasmPath, import.meta.url);
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

function normalizeInputs(inputs) {
  if (inputs == null) {
    return {};
  }
  if (typeof inputs !== "object" || Array.isArray(inputs)) {
    throw new Error("inputs must be an object");
  }
  return inputs;
}

function isNodeRuntime() {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}
