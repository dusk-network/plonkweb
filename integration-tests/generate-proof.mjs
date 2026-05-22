import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  bytesToHex,
  loadPlonkJs
} from "../plonkjs/src/index.mjs";

const outputPath = process.argv[2] ?? "target/integration-test-fixtures/js-proof.json";
const keysPath = "target/integration-test-fixtures/test-keys.json";
const wasmPath = new URL("../plonkjs/dist/plonkwasm.wasm", import.meta.url);
const keys = JSON.parse(await readFile(keysPath, "utf8"));
const keysDir = dirname(keysPath);
const [proverKey, verifierKey] = await Promise.all([
  readFile(join(keysDir, keys.prover_key_path)),
  readFile(join(keysDir, keys.verifier_key_path))
]);
const plonkjs = await loadPlonkJs({ wasmPath });

const proof = await plonkjs.prove(proverKey, {
  seed: new Uint8Array(32).fill(9),
  inputs: {
    left: 13,
    right: 17
  }
});

assert.equal(proof.publicInputs.length, 32);
assert.equal(
  await plonkjs.verify(verifierKey, proof.proof, proof.publicInputs),
  true
);

const fixture = {
  left: 13,
  right: 17,
  product: 221,
  verifier_key_hex: bytesToHex(verifierKey),
  proof_hex: bytesToHex(proof.proof),
  public_inputs_hex: bytesToHex(proof.publicInputs)
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(`${outputPath}`, `${JSON.stringify(fixture, null, 2)}\n`);
