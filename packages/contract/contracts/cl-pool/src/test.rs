#![cfg(test)]
//! cl-pool ↔ oracle-adapter integration tests.
//!
//! The production contract must record an observation with the oracle adapter
//! after every swap — otherwise `get_twap` has no history to answer from and
//! quotes / indexers / wallets get no (or stale) prices.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

use crate::{ClPool, ClPoolClient, Q96};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use position_nft::{PositionNft, PositionNftClient};

/// Deploys cl-pool together with a real position-NFT contract, real token
/// contracts, and an oracle-adapter instance registered for the cl-pool.
fn setup_with_oracle() -> (Env, Address, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let cl_pool_id = env.register(ClPool, ());
    let oracle_id = env.register(OracleAdapter, ());
    let nft_id = env.register(PositionNft, ());

    let admin = Address::generate(&env);
    let token_0 = env.register_stellar_asset_contract(admin.clone());
    let token_1 = env.register_stellar_asset_contract(admin.clone());
    let trader = Address::generate(&env);

    // Fund the trader so token transfers in add_liquidity / swap succeed.
    let token_0_admin = token::StellarAssetClient::new(&env, &token_0);
    let token_1_admin = token::StellarAssetClient::new(&env, &token_1);
    token_0_admin.mint(&trader, &1_000_000_000_000_000i128);
    token_1_admin.mint(&trader, &1_000_000_000_000_000i128);

    // position-nft: cl-pool is the authorised minter.
    PositionNftClient::new(&env, &nft_id).initialize(&cl_pool_id);

    // oracle-adapter: cl-pool is the registered pool allowed to write.
    OracleAdapterClient::new(&env, &oracle_id).initialize(&cl_pool_id);

    let client = ClPoolClient::new(&env, &cl_pool_id);
    client.initialize(&token_0, &token_1, &3_000u32, &Q96, &nft_id);
    client.set_oracle(&oracle_id);

    // In-range liquidity so swaps actually move the price. Kept small enough
    // that cl-pool's `liquidity * Q96` math cannot overflow u128.
    client.add_liquidity(&trader, &-600, &600, &1_000_000u128);

    (env, cl_pool_id, oracle_id, token_0, token_1, trader)
}

#[test]
fn test_swap_records_oracle_observation() {
    let (env, cl_pool_id, oracle_id, token_0, _token_1, trader) = setup_with_oracle();
    let client = ClPoolClient::new(&env, &cl_pool_id);
    let oracle = OracleAdapterClient::new(&env, &oracle_id);

    client.swap(&trader, &true, &1_000u128, &0u128);

    assert_eq!(
        oracle.get_observation_count(),
        1,
        "cl-pool swap must record exactly one observation with the oracle adapter"
    );
}

#[test]
fn test_swap_records_twap_observation() {
    let (env, cl_pool_id, oracle_id, token_0, _token_1, trader) = setup_with_oracle();
    let client = ClPoolClient::new(&env, &cl_pool_id);
    let oracle = OracleAdapterClient::new(&env, &oracle_id);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.swap(&trader, &true, &1_000u128, &0u128);

    env.ledger().with_mut(|l| l.timestamp = 2_000);
    client.swap(&trader, &true, &1_000u128, &0u128);

    let twap = oracle.get_twap(&100);
    assert!(
        twap > 0,
        "TWAP must reflect the post-swap price, got {twap}"
    );
}

#[test]
fn test_swap_without_oracle_wiring_still_succeeds() {
    // No oracle registered: the swap must still work (loud failure only when
    // someone actually asks for a TWAP that was never recorded).
    let env = Env::default();
    env.mock_all_auths();

    let cl_pool_id = env.register(ClPool, ());
    let nft_id = env.register(PositionNft, ());

    let admin = Address::generate(&env);
    let token_0 = env.register_stellar_asset_contract(admin.clone());
    let token_1 = env.register_stellar_asset_contract(admin.clone());
    let trader = Address::generate(&env);

    let token_0_admin = token::StellarAssetClient::new(&env, &token_0);
    let token_1_admin = token::StellarAssetClient::new(&env, &token_1);
    token_0_admin.mint(&trader, &1_000_000_000_000_000i128);
    token_1_admin.mint(&trader, &1_000_000_000_000_000i128);

    PositionNftClient::new(&env, &nft_id).initialize(&cl_pool_id);

    let client = ClPoolClient::new(&env, &cl_pool_id);
    client.initialize(&token_0, &token_1, &3_000u32, &Q96, &nft_id);
    client.add_liquidity(&trader, &-600, &600, &1_000_000u128);

    let (amount_0_delta, amount_1_delta) = client.swap(&trader, &true, &1_000u128, &0u128);
    assert!(amount_0_delta > 0);
    assert!(amount_1_delta < 0);
}
