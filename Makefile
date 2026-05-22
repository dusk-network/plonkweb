.PHONY: cq build-wasm build-wasm-raw build-wasm-rayon serve-example test test-rust test-js

WASM_ARTIFACT := target/wasm32-unknown-unknown/release/examples/test_circuit_wasm.wasm
WASM_RAYON_MAX_MEMORY ?= 2147483648
WASM_RAYON_RUSTFLAGS := -C target-feature=+atomics,+bulk-memory -C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--max-memory=$(WASM_RAYON_MAX_MEMORY) -C link-arg=--export=__heap_base -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base
EXAMPLE_PORT ?= 8000

cq:
	cargo fmt --all -- --check
	cargo clippy --workspace --all-targets -- -D warnings

build-wasm: build-wasm-raw build-wasm-rayon

build-keys:
	cargo test -p plonk-integration-tests --release write_test_keys_fixture

build-wasm-raw:
	mkdir -p plonkjs/dist
	cargo build -p plonk-integration-tests --release --target wasm32-unknown-unknown --example test_circuit_wasm
	cp $(WASM_ARTIFACT) plonkjs/dist/plonkwasm.wasm

build-wasm-rayon:
	mkdir -p plonkjs/dist
	RUSTFLAGS="$(WASM_RAYON_RUSTFLAGS)" rustup run nightly cargo build -p plonk-integration-tests --release --target wasm32-unknown-unknown --example test_circuit_wasm --features wasm-rayon -Z build-std=panic_abort,std
	wasm-bindgen --target web --out-dir plonkjs/dist --out-name plonkwasm --no-typescript --keep-lld-exports $(WASM_ARTIFACT)

serve-example: test-rust build-wasm
	node integration-tests/example/server.mjs $(EXAMPLE_PORT)

test-rust:
	cargo test --workspace --release

test-js:
	npm --prefix plonkjs test

test: test-rust test-js build-wasm
	node integration-tests/generate-proof.mjs target/integration-test-fixtures/js-proof.json
	cargo test -p plonk-integration-tests --release --test js_proof_verification -- --ignored
