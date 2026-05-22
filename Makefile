.PHONY: build-wasm test test-rust test-js

WASM_ARTIFACT := target/wasm32-unknown-unknown/release/examples/test_circuit_wasm.wasm

build-wasm:
	mkdir -p plonkjs/dist
	cargo build -p plonk-integration-tests --release --locked --target wasm32-unknown-unknown --example test_circuit_wasm
	cp $(WASM_ARTIFACT) plonkjs/dist/plonkwasm.wasm

test-rust:
	cargo test --workspace --release

test-js:
	npm --prefix plonkjs test

test: test-rust test-js build-wasm
	node integration-tests/generate-proof.mjs target/integration-test-fixtures/js-proof.json
	cargo test -p plonk-integration-tests --release --test js_proof_verification -- --ignored
