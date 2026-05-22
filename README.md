# PlonkWeb

JavaScript API and WebAssembly wrapper for `dusk-plonk`, meant to
compute proofs in-browser.

**DISCLAIMER:** this project is currently unstable, use at your own risk.

## Layout

- `plonkwasm`: Rust crate with the reusable proof helper API. Its core public
  API is `prove()` and `verify()`, plus wasm ABI helpers for crates that link
  a concrete circuit.
- `plonkjs`: JavaScript package that loads a compatible wasm artifact and calls
  the exported proof API.
- `integration-tests`: Test-only Rust crate containing integration testing.

## Test

To execute all the tests, simply run:

```sh
make test
```

The integration test generates keys for `TestCircuit`, builds the test wasm,
computes a proof through `plonkjs`, serializes the proof bytes, and verifies
them with the Rust verifier from `dusk-plonk`.

To run the browser benchmark with wasm Rayon enabled, use:

```sh
make serve-example
```

This builds the raw wasm used by Node tests plus the wasm-bindgen/Rayon browser
artifact, then serves the example with the COOP/COEP headers required by
`SharedArrayBuffer` and WebAssembly threads.
The threaded wasm build expects a nightly Rust toolchain with `rust-src` and the
`wasm-bindgen` CLI available on `PATH`.
The shared-memory maximum defaults to 2 GiB; override it for larger circuits
with `WASM_RAYON_MAX_MEMORY=<bytes> make build-wasm-rayon`.

## JavaScript API Shape

```js
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadPlonkJs } from "./plonkjs/src/index.mjs";

const keysPath = "target/integration-test-fixtures/test-keys.json";
const keys = JSON.parse(
  await readFile(keysPath, "utf8")
);
const keysDir = dirname(keysPath);
const [proverKey, verifierKey] = await Promise.all([
  readFile(join(keysDir, keys.prover_key_path)),
  readFile(join(keysDir, keys.verifier_key_path))
]);
const plonkjs = await loadPlonkJs({
  modulePath: new URL("./plonkjs/dist/plonkwasm.js", import.meta.url),
  threads: true
});

const { proof, publicInputs } = await plonkjs.prove(proverKey, {
  seed: new Uint8Array(32).fill(9),
  inputs: {
    left: 13,
    right: 17
  }
});

const verified = await plonkjs.verify(verifierKey, proof, publicInputs);
```

The wasm artifact must still include a concrete circuit. The generic
`plonkwasm` crate supplies proof plumbing; the circuit is linked by the crate
that builds the wasm binary. For the integration test wasm, `left` and `right`
are the circuit inputs and the public input is their product.
