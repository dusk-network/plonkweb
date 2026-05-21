# PlonkWeb

JavaScript API and WebAssembly wrapper for `dusk-plonk`, meant to
compute proofs in-browser.

**DISCLAIMER:** this project is currently unstable, use at your own risk.

## Layout

- `plonkwasm`: Rust crate with the reusable proof helper API. Its core public
  API is `prove()`, plus wasm ABI helpers for crates that link a concrete
  circuit.
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

## JavaScript API Shape

```js
import { readFile } from "node:fs/promises";
import { loadPlonkJs } from "./plonkjs/src/index.mjs";

const keys = JSON.parse(
  await readFile("target/integration-test-fixtures/test-keys.json", "utf8")
);
const sdk = await loadPlonkJs({
  wasmPath: new URL("./plonkjs/dist/plonkwasm.wasm", import.meta.url)
});

const { proof, publicInputs } = await sdk.prove(keys.prover_key_hex, {
  seed: new Uint8Array(32).fill(9),
  inputs: {
    left: 13,
    right: 17
  }
});
```

The wasm artifact must still include a concrete circuit. The generic
`plonkwasm` crate supplies proof plumbing; the circuit is linked by the crate
that builds the wasm binary. For the integration test wasm, `left` and `right`
are the circuit inputs and the public input is their product.
