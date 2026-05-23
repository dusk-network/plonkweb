# PlonkWeb

[![Repository](https://img.shields.io/badge/github-plonkweb-blueviolet?logo=github)](https://github.com/dusk-network/plonkweb)
[![CI](https://github.com/dusk-network/plonkweb/actions/workflows/ci.yml/badge.svg)](https://github.com/dusk-network/plonkweb/actions/workflows/ci.yml)

JavaScript and WebAssembly tooling for generating and verifying
[`dusk-plonk`](https://crates.io/crates/dusk-plonk) proofs in the browser.

> ⚠️ **DISCLAIMER:** this code is experimental, and thus, unstable. Use at
> your own risk.

## 📦 Workspace Layout

- [PlonkWasm](plonkwasm): a Rust crate with reusable proof, verification, serialization,
  and wasm ABI helpers.
- [PlonkJS](plonkjs): a JavaScript loader that calls the exported wasm proof API.
- [integration-tests](integration-tests): a test crate that links a concrete circuit, builds the
  wasm artifact, and verifies the JavaScript proof flow from Rust.

## 🚀 Quick Start

Run the full test flow:

```sh
make test
```

That command:

1. Generates prover and verifier keys for the integration test circuit.
2. Builds the test wasm artifact.
3. Computes a proof through `plonkjs`.
4. Verifies the serialized proof with the Rust verifier from `dusk-plonk`.

## 🧪 Rust and JavaScript Checks

Run only the Rust tests:

```sh
make test-rust
```

Build the raw wasm artifact used by Node tests:

```sh
make build-wasm-raw
```

## ⚡ WebApp Example

Run the browser benchmark/example with wasm Rayon enabled:

```sh
make serve-example
```

This builds the raw wasm used by Node tests plus the wasm-bindgen/Rayon browser
artifact, then serves the example with the COOP/COEP headers required by
`SharedArrayBuffer` and WebAssembly threads.

The threaded wasm build currently expects:

- a nightly Rust toolchain with `rust-src`
- the `wasm-bindgen` CLI on `PATH`
- browser support for `SharedArrayBuffer`

The shared-memory maximum defaults to 2 GiB. Override it for larger circuits:

```sh
WASM_RAYON_MAX_MEMORY=<bytes> make build-wasm-rayon
```

## 🌐 JavaScript API Shape

```js
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadPlonkJs } from "./plonkjs/src/index.mjs";

const keysPath = "target/integration-test-fixtures/test-keys.json";
const keys = JSON.parse(await readFile(keysPath, "utf8"));
const keysDir = dirname(keysPath);

const [proverKey, verifierKey] = await Promise.all([
  readFile(join(keysDir, keys.prover_key_path)),
  readFile(join(keysDir, keys.verifier_key_path))
]);

const plonkjs = await loadPlonkJs({
  modulePath: new URL("./plonkjs/dist/plonkwasm.js", import.meta.url),
  threads: true
});
await plonkjs.init(proverKey, verifierKey);

const { proof, publicInputs } = await plonkjs.prove({
  seed: new Uint8Array(32).fill(9),
  inputs: {
    left: 13,
    right: 17
  }
});

const verified = await plonkjs.verify(proof, publicInputs);
```

For the integration test wasm, `left` and `right` are circuit inputs and the
public input is their product.

## 📜 License

This project is licensed under the Mozilla Public License Version 2.0
(`MPL-2.0`). See [LICENSE](LICENSE) for the full license text.
