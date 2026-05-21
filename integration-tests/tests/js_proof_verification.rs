// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) DUSK NETWORK. All rights reserved.

use dusk_bytes::Serializable;
use dusk_plonk::prelude::{BlsScalar, Proof, Verifier};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct JsProofFixture {
    left: u64,
    right: u64,
    product: u64,
    verifier_key_hex: String,
    proof_hex: String,
    public_inputs_hex: String,
}

#[test]
#[ignore = "requires the Node-generated proof fixture from `make test`"]
fn rust_verifier_accepts_js_wasm_generated_proof() {
    let fixture_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../target/integration-test-fixtures/js-proof.json");
    let fixture = std::fs::read_to_string(&fixture_path).unwrap_or_else(|err| {
        panic!(
            "failed to read {}: {err}. Run `make test` to generate the JavaScript proof fixture.",
            fixture_path.display()
        )
    });
    let fixture: JsProofFixture = serde_json::from_str(&fixture).unwrap();

    assert_eq!(fixture.left * fixture.right, fixture.product);

    let verifier_key = plonkwasm::wasm::decode_hex(&fixture.verifier_key_hex).unwrap();
    let proof = plonkwasm::wasm::decode_hex(&fixture.proof_hex).unwrap();
    let public_inputs = plonkwasm::wasm::decode_hex(&fixture.public_inputs_hex).unwrap();

    let verifier = Verifier::try_from_bytes(&verifier_key).unwrap();
    let proof = Proof::from_bytes(proof.as_slice().try_into().unwrap()).unwrap();
    let public_inputs = public_inputs
        .chunks_exact(32)
        .map(|chunk| {
            let bytes: [u8; 32] = chunk.try_into().unwrap();
            Option::<BlsScalar>::from(BlsScalar::from_bytes(&bytes)).unwrap()
        })
        .collect::<Vec<_>>();

    verifier.verify(&proof, &public_inputs).unwrap();
}
