// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) DUSK NETWORK. All rights reserved.

use plonk_integration_tests::test_circuit::TestCircuit;
use serde::{Deserialize, Serialize};

#[cfg(all(target_arch = "wasm32", feature = "wasm-rayon"))]
pub use wasm_bindgen_rayon::init_thread_pool;

#[derive(Debug, Deserialize)]
struct ProveRequest {
    prover_key_hex: String,
    seed_hex: String,
    left: u64,
    right: u64,
}

#[derive(Debug, Serialize)]
struct ProveResponse {
    proof_hex: String,
    public_inputs_hex: String,
}

#[derive(Debug, Deserialize)]
struct VerifyRequest {
    verifier_key_hex: String,
    proof_hex: String,
    public_inputs_hex: String,
}

#[derive(Debug, Serialize)]
struct VerifyResponse {
    verified: bool,
}

#[no_mangle]
pub extern "C" fn plonkweb_alloc(len: usize) -> *mut u8 {
    plonkwasm::wasm::alloc(len)
}

#[no_mangle]
pub unsafe extern "C" fn plonkweb_free(ptr: *mut u8, len: usize) {
    plonkwasm::wasm::free(ptr, len);
}

#[no_mangle]
pub unsafe extern "C" fn plonkweb_prove(request_ptr: *const u8, request_len: usize) -> u64 {
    plonkwasm::wasm::respond_from_request(request_ptr, request_len, prove_test_circuit)
}

#[no_mangle]
pub unsafe extern "C" fn plonkweb_verify(request_ptr: *const u8, request_len: usize) -> u64 {
    plonkwasm::wasm::respond_from_request(request_ptr, request_len, verify_test_circuit)
}

#[no_mangle]
pub unsafe extern "C" fn plonkweb_prove_bytes(
    prover_key_ptr: *const u8,
    prover_key_len: usize,
    seed_ptr: *const u8,
    seed_len: usize,
    left: u64,
    right: u64,
) -> u64 {
    plonkwasm::wasm::respond(prove_test_circuit_bytes(
        core::slice::from_raw_parts(prover_key_ptr, prover_key_len),
        core::slice::from_raw_parts(seed_ptr, seed_len),
        left,
        right,
    ))
}

#[no_mangle]
pub unsafe extern "C" fn plonkweb_verify_bytes(
    verifier_key_ptr: *const u8,
    verifier_key_len: usize,
    proof_ptr: *const u8,
    proof_len: usize,
    public_inputs_ptr: *const u8,
    public_inputs_len: usize,
) -> u64 {
    plonkwasm::wasm::respond(verify_test_circuit_bytes(
        core::slice::from_raw_parts(verifier_key_ptr, verifier_key_len),
        core::slice::from_raw_parts(proof_ptr, proof_len),
        core::slice::from_raw_parts(public_inputs_ptr, public_inputs_len),
    ))
}

fn prove_test_circuit(request: &[u8]) -> Result<ProveResponse, String> {
    let request: ProveRequest =
        serde_json::from_slice(request).map_err(|err| format!("invalid prove request: {err}"))?;
    let prover_key = plonkwasm::wasm::decode_hex(&request.prover_key_hex)?;
    let seed = plonkwasm::wasm::decode_seed(&request.seed_hex)?;
    prove_test_circuit_bytes(&prover_key, &seed, request.left, request.right)
}

fn prove_test_circuit_bytes(
    prover_key: &[u8],
    seed: &[u8],
    left: u64,
    right: u64,
) -> Result<ProveResponse, String> {
    let seed: [u8; 32] = seed
        .try_into()
        .map_err(|_| format!("seed must be 32 bytes, got {}", seed.len()))?;
    let circuit = TestCircuit::new(left, right);
    let proof = plonkwasm::prove(prover_key, seed, &circuit)?;

    Ok(ProveResponse {
        proof_hex: plonkwasm::wasm::encode_hex(&proof.proof),
        public_inputs_hex: plonkwasm::wasm::encode_hex(&proof.public_inputs),
    })
}

fn verify_test_circuit(request: &[u8]) -> Result<VerifyResponse, String> {
    let request: VerifyRequest =
        serde_json::from_slice(request).map_err(|err| format!("invalid verify request: {err}"))?;
    let verifier_key = plonkwasm::wasm::decode_hex(&request.verifier_key_hex)?;
    let proof = plonkwasm::wasm::decode_hex(&request.proof_hex)?;
    let public_inputs = plonkwasm::wasm::decode_hex(&request.public_inputs_hex)?;

    verify_test_circuit_bytes(&verifier_key, &proof, &public_inputs)
}

fn verify_test_circuit_bytes(
    verifier_key: &[u8],
    proof: &[u8],
    public_inputs: &[u8],
) -> Result<VerifyResponse, String> {
    plonkwasm::verify(verifier_key, proof, public_inputs)?;

    Ok(VerifyResponse { verified: true })
}
