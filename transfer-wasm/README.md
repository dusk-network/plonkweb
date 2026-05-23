# Dusk transfer WASM benchmark

This crate builds a real Phoenix transfer prover for browser WASM. It exposes
the standard `plonkweb` circuit ABI (`plonkweb_init`, `plonkweb_prove`, and
`plonkweb_verify`) so it can be loaded by `plonkjs` like the integration-test
artifact.

Current fixture defaults:

- circuit: `TxCircuitFourTwo`
- input notes: 4
- circuit bytes: `/home/hein_/projects/rusk-private-boreas-full-blst/rusk-prover/tests/tx_circuit_vec.hex`
- prover key: `/home/hein_/.dusk/rusk/keys/58929845e2fa0ba344dc378af9ef2c9edbe1346439a4c786b80b79ab3e07d6cf.pk`
- verifier key: same path with `.vd`

Build the Dusk BLS backend currently patched in this crate. The benchmark crate
is excluded from the root workspace so normal `plonkweb` CI does not need local
Rusk paths or private benchmark dependencies. Its manifest patch points at
`dusk-network/plonk-private` branch `browser-wasm-transfer-bench` for the
prover hot-path and trusted unchecked key loading changes.

```sh
make build-transfer-wasm-rayon
```

`plonkweb_init` uses `Prover::try_from_trusted_unchecked_bytes`, which validates
the serialized container lengths but skips commit-key point validation. It is
only appropriate when the `.pk` is a local/generated trusted artifact, not user
supplied bytes. For `TxCircuitFourTwo` this reduced browser prover decode from
about 32 seconds to about 3.5 seconds without changing artifact size or
steady-state memory.

The `plonkweb_prove` JSON request accepts the normal `seed_hex` field plus a
Phoenix transfer fixture in `tx_circuit_vec_hex`. `plonkweb_verify` accepts the
standard `proof_hex` and `public_inputs_hex` fields.

To test another `dusk-plonk` worktree without editing the root manifest, pass
Cargo config through the Makefile:

```sh
make build-transfer-wasm-rayon \
  TRANSFER_WASM_CARGO_ARGS='--config patch.crates-io.dusk-plonk.path="/home/hein_/projects/plonk-private-boreas-full-blst"'
```

For the BLST branch, also add `blst-backend` to the `dusk-plonk` dependency
features in `transfer-wasm/Cargo.toml`; the current Dusk-BLS branch does not
declare that feature, so it cannot be made a shared workspace feature.

The browser harness used during investigation is intentionally not included in
this branch.
