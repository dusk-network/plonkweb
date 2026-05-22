// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) DUSK NETWORK. All rights reserved.

use dusk_plonk::prelude::{
    BlsScalar, Circuit, Compiler, Composer, Constraint, Error as PlonkError, PublicParameters,
};
use rand_chacha::ChaCha20Rng;
use rand_core::SeedableRng;

const TRANSCRIPT_LABEL: &[u8] = b"plonkweb-test-v1";
const TEST_CIRCUIT_CAPACITY: usize = 1 << 8;
const TEST_CIRCUIT_MULTIPLICATIONS: usize = 1;

#[derive(Debug, Clone, Copy, Default)]
pub struct TestCircuit {
    left: BlsScalar,
    right: BlsScalar,
    product: BlsScalar,
}

impl TestCircuit {
    /// Builds the circuit witness for `left * right = product`.
    pub fn new(left: u64, right: u64) -> Self {
        let left = BlsScalar::from(left);
        let right = BlsScalar::from(right);
        let product = left * right;

        Self {
            left,
            right,
            product,
        }
    }
}

impl Circuit for TestCircuit {
    fn circuit(&self, composer: &mut Composer) -> Result<(), PlonkError> {
        let left = composer.append_witness(self.left);
        let right = composer.append_witness(self.right);

        let public_product = composer.append_public(self.product);
        let mut computed = dusk_plonk::prelude::Witness::default();
        
        for _ in 0..TEST_CIRCUIT_MULTIPLICATIONS {
            let constraint = Constraint::new().mult(1).a(left).b(right);
            computed = composer.gate_mul(constraint);
        }

        composer.assert_equal(computed, public_product);
        Ok(())
    }
}

/// Compiles deterministic prover and verifier keys for the integration circuit.
pub fn compile_test_keys(seed: [u8; 32]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let mut rng = ChaCha20Rng::from_seed(seed);
    let pp = PublicParameters::setup(TEST_CIRCUIT_CAPACITY, &mut rng)
        .map_err(|err| format!("{err:?}"))?;
    let (prover, verifier) = Compiler::compile::<TestCircuit>(&pp, TRANSCRIPT_LABEL)
        .map_err(|err| format!("{err:?}"))?;

    Ok((prover.to_bytes(), verifier.to_bytes()))
}

#[cfg(test)]
mod tests {
    use serde::Serialize;

    #[derive(Debug, Serialize)]
    struct TestKeysFixture {
        prover_key_path: &'static str,
        verifier_key_path: &'static str,
    }

    #[test]
    fn write_test_keys_fixture() {
        let (prover_key, verifier_key) = super::compile_test_keys([7; 32]).unwrap();
        let fixture = TestKeysFixture {
            prover_key_path: "test-prover-key.bin",
            verifier_key_path: "test-verifier-key.bin",
        };
        let fixture_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../target/integration-test-fixtures/test-keys.json");
        let fixture_dir = fixture_path.parent().unwrap();

        std::fs::create_dir_all(fixture_dir).unwrap();
        std::fs::write(fixture_dir.join(fixture.prover_key_path), prover_key).unwrap();
        std::fs::write(fixture_dir.join(fixture.verifier_key_path), verifier_key).unwrap();
        std::fs::write(
            fixture_path,
            format!("{}\n", serde_json::to_string_pretty(&fixture).unwrap()),
        )
        .unwrap();
    }
}
