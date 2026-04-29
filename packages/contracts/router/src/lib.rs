#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec};

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Pool(Address, Address),
}

#[contracttype]
#[derive(Clone)]
pub struct SwapEvent {
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: i128,
    pub amount_out: i128,
}

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    pub fn set_pool_rate(env: Env, token_in: Address, token_out: Address, rate: i128) {
        if rate <= 0 {
            panic!("invalid pool rate");
        }

        env.storage()
            .instance()
            .set(&DataKey::Pool(token_in, token_out), &rate);
    }

    pub fn exact_input_single(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_amount_out: i128,
        deadline: u64,
    ) -> i128 {
        ensure_deadline(&env, deadline);
        ensure_positive_amount(amount_in);

        let amount_out = execute_exact_input_hop(&env, token_in, token_out, amount_in);
        if amount_out < min_amount_out {
            panic!("slippage breach");
        }

        amount_out
    }

    pub fn exact_output_single(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_out: i128,
        max_amount_in: i128,
        deadline: u64,
    ) -> i128 {
        ensure_deadline(&env, deadline);
        ensure_positive_amount(amount_out);

        let amount_in = quote_exact_output_hop(&env, &token_in, &token_out, amount_out);
        if amount_in > max_amount_in {
            panic!("excessive input");
        }

        publish_swap(&env, token_in, token_out, amount_in, amount_out);
        amount_in
    }

    pub fn exact_input(
        env: Env,
        path: Vec<Address>,
        amount_in: i128,
        min_amount_out: i128,
        deadline: u64,
    ) -> i128 {
        ensure_deadline(&env, deadline);
        ensure_positive_amount(amount_in);
        ensure_path(&path);

        let mut amount = amount_in;
        let mut index = 0;

        while index + 1 < path.len() {
            let token_in = path.get(index).unwrap();
            let token_out = path.get(index + 1).unwrap();
            amount = execute_exact_input_hop(&env, token_in, token_out, amount);
            index += 1;
        }

        if amount < min_amount_out {
            panic!("slippage breach");
        }

        amount
    }

    pub fn exact_output(
        env: Env,
        path: Vec<Address>,
        amount_out: i128,
        max_amount_in: i128,
        deadline: u64,
    ) -> i128 {
        ensure_deadline(&env, deadline);
        ensure_positive_amount(amount_out);
        ensure_path(&path);

        let mut amount = amount_out;
        let mut index = path.len() - 1;

        while index > 0 {
            let token_in = path.get(index - 1).unwrap();
            let token_out = path.get(index).unwrap();
            let amount_in = quote_exact_output_hop(&env, &token_in, &token_out, amount);
            publish_swap(&env, token_in, token_out, amount_in, amount);
            amount = amount_in;
            index -= 1;
        }

        if amount > max_amount_in {
            panic!("excessive input");
        }

        amount
    }

    pub fn get_router_balance(_env: Env, _token: Address) -> i128 {
        0
    }
}

fn ensure_deadline(env: &Env, deadline: u64) {
    if env.ledger().timestamp() > deadline {
        panic!("expired deadline");
    }
}

fn ensure_positive_amount(amount: i128) {
    if amount <= 0 {
        panic!("invalid amount");
    }
}

fn ensure_path(path: &Vec<Address>) {
    if path.len() < 2 {
        panic!("invalid path");
    }
}

fn execute_exact_input_hop(
    env: &Env,
    token_in: Address,
    token_out: Address,
    amount_in: i128,
) -> i128 {
    let rate = read_pool_rate(env, &token_in, &token_out);
    let amount_out = amount_in
        .checked_mul(rate)
        .unwrap_or_else(|| panic!("swap overflow"));

    publish_swap(env, token_in, token_out, amount_in, amount_out);
    amount_out
}

fn quote_exact_output_hop(
    env: &Env,
    token_in: &Address,
    token_out: &Address,
    amount_out: i128,
) -> i128 {
    let rate = read_pool_rate(env, token_in, token_out);
    div_ceil(amount_out, rate)
}

fn read_pool_rate(env: &Env, token_in: &Address, token_out: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::Pool(token_in.clone(), token_out.clone()))
        .unwrap_or_else(|| panic!("hop failed"))
}

fn div_ceil(value: i128, divisor: i128) -> i128 {
    (value + divisor - 1) / divisor
}

fn publish_swap(
    env: &Env,
    token_in: Address,
    token_out: Address,
    amount_in: i128,
    amount_out: i128,
) {
    env.events().publish(
        (
            Symbol::new(env, "Swap"),
            token_in.clone(),
            token_out.clone(),
        ),
        SwapEvent {
            token_in,
            token_out,
            amount_in,
            amount_out,
        },
    );
}
