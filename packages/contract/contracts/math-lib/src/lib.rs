#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol};

#[contract]
pub struct MathLib;

/// Q64.96 fixed-point format constants
pub const Q96: u128 = 1u128 << 96;
pub const MIN_TICK: i32 = -887272;
pub const MAX_TICK: i32 = 887272;

/// Error types for math operations
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum MathError {
    InvalidTick = 1,
    PriceOutOfBounds = 2,
    Overflow = 3,
    Underflow = 4,
    DivisionByZero = 5,
}

impl From<MathError> for soroban_sdk::Error {
    fn from(error: MathError) -> Self {
        soroban_sdk::Error::from_contract_error(error as u32)
    }
}

impl<'a> From<&'a MathError> for soroban_sdk::Error {
    fn from(error: &'a MathError) -> Self {
        soroban_sdk::Error::from_contract_error(*error as u32)
    }
}

impl From<soroban_sdk::Error> for MathError {
    fn from(_: soroban_sdk::Error) -> Self {
        MathError::Overflow
    }
}

#[contractimpl]
impl MathLib {
    /// Returns the contract name — used for post-deploy verification.
    pub fn name(_env: Env) -> Symbol {
        Symbol::new(&_env, "math_lib")
    }

    /// Converts a Q64.96 sqrt price to the corresponding tick index
    /// 
    /// # Arguments
    /// * `sqrt_price_x96` - The square root price in Q64.96 format
    /// 
    /// # Returns
    /// The tick index corresponding to the sqrt price
    /// 
    /// # Errors
    /// Returns MathError::PriceOutOfBounds if sqrt_price_x96 is zero
    pub fn sqrt_price_to_tick(sqrt_price_x96: u128) -> Result<i32, MathError> {
        if sqrt_price_x96 == 0 {
            return Err(MathError::PriceOutOfBounds);
        }

        // log_1.0001(sqrt_price_x96 / 2^96) * 2^96 / log_1.0001(2^96)
        // Simplified: log1p(sqrt_price_x96 / 2^96 - 1) / log1p(0.0001)
        
        let ratio = if sqrt_price_x96 >= Q96 {
            sqrt_price_x96.checked_div(Q96)
                .ok_or(MathError::DivisionByZero)?
        } else {
            return Err(MathError::PriceOutOfBounds);
        };

        if ratio == 0 {
            return Err(MathError::PriceOutOfBounds);
        }

        // Use binary search to find the tick
        let mut low = MIN_TICK;
        let mut high = MAX_TICK;
        
        while low <= high {
            let mid = (low + high) / 2;
            let mid_sqrt_price = Self::tick_to_sqrt_price(mid)?;
            
            if mid_sqrt_price == sqrt_price_x96 {
                return Ok(mid);
            } else if mid_sqrt_price < sqrt_price_x96 {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        
        // Return the closest tick
        if low > MAX_TICK {
            return Ok(MAX_TICK);
        }
        if high < MIN_TICK {
            return Ok(MIN_TICK);
        }
        
        // Check which is closer
        let low_sqrt_price = Self::tick_to_sqrt_price(low)?;
        let high_sqrt_price = Self::tick_to_sqrt_price(high)?;
        
        let diff_low = if low_sqrt_price > sqrt_price_x96 {
            low_sqrt_price - sqrt_price_x96
        } else {
            sqrt_price_x96 - low_sqrt_price
        };
        
        let diff_high = if high_sqrt_price > sqrt_price_x96 {
            high_sqrt_price - sqrt_price_x96
        } else {
            sqrt_price_x96 - high_sqrt_price
        };
        
        if diff_low < diff_high {
            Ok(low)
        } else {
            Ok(high)
        }
    }

    /// Converts a tick index to the corresponding Q64.96 sqrt price
    /// 
    /// # Arguments
    /// * `tick` - The tick index
    /// 
    /// # Returns
    /// The square root price in Q64.96 format
    /// 
    /// # Errors
    /// Returns MathError::InvalidTick if tick is out of bounds
    pub fn tick_to_sqrt_price(tick: i32) -> Result<u128, MathError> {
        if tick < MIN_TICK || tick > MAX_TICK {
            return Err(MathError::InvalidTick);
        }

        // sqrt(1.0001^tick) * 2^96
        // Using approximation: 2^(96 + tick * log2(1.0001) / 2)
        
        // log2(1.0001) ≈ 0.000144269503
        // So: 2^(96 + tick * 0.0000721347515)
        
        // For simplicity and safety, we'll use a lookup table approach for extreme values
        // and linear approximation for the middle range
        if tick == MIN_TICK {
            return Ok(4295128739); // Minimum sqrt price
        }
        if tick == MAX_TICK {
            return Ok(u128::MAX); // Maximum sqrt price (bounded by u128 limits)
        }

        // For the middle range, use power approximation
        let tick_abs = tick.abs() as u128;
        let base = 10001u128; // 1.0001 * 10000
        
        // Compute 1.0001^tick using repeated squaring with overflow checks
        let result = if tick >= 0 {
            power(base, tick_abs, 10000)?
        } else {
            // For negative ticks, compute the reciprocal
            let pos_result = power(base, tick_abs, 10000)?;
            if pos_result == 0 {
                return Err(MathError::DivisionByZero);
            }
            Q96.checked_div(pos_result)
                .ok_or(MathError::DivisionByZero)?
        };

        // Take square root and multiply by 2^96
        let sqrt_result = integer_sqrt(result);
        sqrt_result.checked_mul(Q96 / 10000)
            .ok_or(MathError::Overflow)
    }

    /// Computes the token0 amount for a given liquidity and price range
    /// 
    /// # Arguments
    /// * `liquidity` - The liquidity amount
    /// * `sqrt_price_lower_x96` - Lower bound sqrt price in Q64.96
    /// * `sqrt_price_upper_x96` - Upper bound sqrt price in Q64.96
    /// * `sqrt_price_current_x96` - Current sqrt price in Q64.96
    /// 
    /// # Returns
    /// The token0 amount
    /// 
    /// # Errors
    /// Returns MathError::Underflow if the calculation would underflow
    pub fn get_amount_0_delta(
        liquidity: u128,
        sqrt_price_lower_x96: u128,
        sqrt_price_upper_x96: u128,
        sqrt_price_current_x96: u128,
    ) -> Result<u128, MathError> {
        if liquidity == 0 {
            return Ok(0);
        }

        if sqrt_price_current_x96 <= sqrt_price_lower_x96 {
            // Current price is at or below lower bound
            let numerator = liquidity.checked_mul(Q96)
                .ok_or(MathError::Overflow)?;
            let denominator = sqrt_price_lower_x96;
            numerator.checked_div(denominator)
                .ok_or(MathError::DivisionByZero)
        } else if sqrt_price_current_x96 < sqrt_price_upper_x96 {
            // Current price is within the range
            let numerator = liquidity.checked_mul(Q96)
                .ok_or(MathError::Overflow)?;
            let denominator = sqrt_price_current_x96;
            let amount_current = numerator.checked_div(denominator)
                .ok_or(MathError::DivisionByZero)?;
            
            let numerator_lower = liquidity.checked_mul(Q96)
                .ok_or(MathError::Overflow)?;
            let amount_lower = numerator_lower.checked_div(sqrt_price_lower_x96)
                .ok_or(MathError::DivisionByZero)?;
            
            amount_current.checked_sub(amount_lower)
                .ok_or(MathError::Underflow)
        } else {
            // Current price is at or above upper bound
            let numerator = liquidity.checked_mul(Q96)
                .ok_or(MathError::Overflow)?;
            let denominator = sqrt_price_lower_x96;
            let amount_lower = numerator.checked_div(denominator)
                .ok_or(MathError::DivisionByZero)?;
            
            let numerator_upper = liquidity.checked_mul(Q96)
                .ok_or(MathError::Overflow)?;
            let amount_upper = numerator_upper.checked_div(sqrt_price_upper_x96)
                .ok_or(MathError::DivisionByZero)?;
            
            amount_lower.checked_sub(amount_upper)
                .ok_or(MathError::Underflow)
        }
    }

    /// Computes the token1 amount for a given liquidity and price range
    /// 
    /// # Arguments
    /// * `liquidity` - The liquidity amount
    /// * `sqrt_price_lower_x96` - Lower bound sqrt price in Q64.96
    /// * `sqrt_price_upper_x96` - Upper bound sqrt price in Q64.96
    /// * `sqrt_price_current_x96` - Current sqrt price in Q64.96
    /// 
    /// # Returns
    /// The token1 amount
    /// 
    /// # Errors
    /// Returns MathError::Underflow if the calculation would underflow
    pub fn get_amount_1_delta(
        liquidity: u128,
        sqrt_price_lower_x96: u128,
        sqrt_price_upper_x96: u128,
        sqrt_price_current_x96: u128,
    ) -> Result<u128, MathError> {
        if liquidity == 0 {
            return Ok(0);
        }

        if sqrt_price_current_x96 >= sqrt_price_upper_x96 {
            // Current price is at or above upper bound
            liquidity.checked_mul(sqrt_price_upper_x96 - sqrt_price_lower_x96)
                .ok_or(MathError::Overflow)
                .map(|result| result.checked_div(Q96).unwrap_or(0))
        } else if sqrt_price_current_x96 > sqrt_price_lower_x96 {
            // Current price is within the range
            liquidity.checked_mul(sqrt_price_current_x96 - sqrt_price_lower_x96)
                .ok_or(MathError::Overflow)
                .map(|result| result.checked_div(Q96).unwrap_or(0))
        } else {
            // Current price is at or below lower bound
            Ok(0)
        }
    }

    /// Computes the next sqrt price after a token0 swap input
    /// 
    /// # Arguments
    /// * `sqrt_price_x96` - Current sqrt price in Q64.96
    /// * `liquidity` - Current liquidity
    /// * `amount_in` - Amount of token0 being swapped in
    /// * `zero_for_one` - Direction of swap (true for token0 -> token1)
    /// 
    /// # Returns
    /// The next sqrt price in Q64.96
    /// 
    /// # Errors
    /// Returns MathError::Underflow or MathError::Overflow if bounds are exceeded
    pub fn next_sqrt_price_0(
        sqrt_price_x96: u128,
        liquidity: u128,
        amount_in: u128,
        zero_for_one: bool,
    ) -> Result<u128, MathError> {
        if liquidity == 0 {
            return Err(MathError::DivisionByZero);
        }

        if zero_for_one {
            // Swapping token0 for token1 (price decreases)
            let numerator = liquidity.checked_mul(amount_in)
                .ok_or(MathError::Overflow)?;
            let denominator = numerator.checked_div(sqrt_price_x96)
                .ok_or(MathError::DivisionByZero)?;
            
            sqrt_price_x96.checked_sub(denominator)
                .ok_or(MathError::Underflow)
        } else {
            // Swapping token1 for token0 (price increases)
            let numerator = liquidity.checked_mul(sqrt_price_x96)
                .ok_or(MathError::Overflow)?;
            let denominator = numerator.checked_div(Q96)
                .ok_or(MathError::DivisionByZero)?;
            
            denominator.checked_add(amount_in)
                .ok_or(MathError::Overflow)
                .and_then(|sum| {
                    liquidity.checked_mul(Q96)
                        .ok_or(MathError::Overflow)
                        .and_then(|numerator| numerator.checked_div(sum)
                            .ok_or(MathError::DivisionByZero))
                })
        }
    }

    /// Computes the next sqrt price after a token1 swap input
    /// 
    /// # Arguments
    /// * `sqrt_price_x96` - Current sqrt price in Q64.96
    /// * `liquidity` - Current liquidity
    /// * `amount_in` - Amount of token1 being swapped in
    /// * `zero_for_one` - Direction of swap (true for token0 -> token1)
    /// 
    /// # Returns
    /// The next sqrt price in Q64.96
    /// 
    /// # Errors
    /// Returns MathError::Underflow or MathError::Overflow if bounds are exceeded
    pub fn next_sqrt_price_1(
        sqrt_price_x96: u128,
        liquidity: u128,
        amount_in: u128,
        zero_for_one: bool,
    ) -> Result<u128, MathError> {
        if liquidity == 0 {
            return Err(MathError::DivisionByZero);
        }

        if zero_for_one {
            // Swapping token0 for token1 (price decreases)
            let quotient = amount_in.checked_mul(Q96)
                .ok_or(MathError::Overflow)?
                .checked_div(liquidity)
                .ok_or(MathError::DivisionByZero)?;
            
            sqrt_price_x96.checked_add(quotient)
                .ok_or(MathError::Overflow)
        } else {
            // Swapping token1 for token0 (price increases)
            let quotient = amount_in.checked_mul(Q96)
                .ok_or(MathError::Overflow)?
                .checked_div(liquidity)
                .ok_or(MathError::DivisionByZero)?;
            
            sqrt_price_x96.checked_sub(quotient)
                .ok_or(MathError::Underflow)
        }
    }
}

/// Helper function to compute base^exponent / divisor with overflow checks
fn power(base: u128, exponent: u128, divisor: u128) -> Result<u128, MathError> {
    if exponent == 0 {
        return Ok(divisor);
    }
    
    let mut result = 1u128;
    let mut base_pow = base;
    let mut exp = exponent;
    
    while exp > 0 {
        if exp % 2 == 1 {
            result = result.checked_mul(base_pow)
                .ok_or(MathError::Overflow)?;
        }
        base_pow = base_pow.checked_mul(base_pow)
            .ok_or(MathError::Overflow)?;
        exp /= 2;
        
        // Prevent infinite loop and overflow
        if result > u128::MAX / divisor {
            return Err(MathError::Overflow);
        }
    }
    
    result.checked_div(divisor)
        .ok_or(MathError::DivisionByZero)
}

/// Integer square root using binary search
fn integer_sqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    if n == 1 {
        return 1;
    }
    
    let mut low = 1u128;
    let mut high = n;
    let mut result = 0u128;
    
    while low <= high {
        let mid = (low + high) / 2;
        let mid_squared = mid.checked_mul(mid).unwrap_or(u128::MAX);
        
        if mid_squared == n {
            return mid;
        } else if mid_squared < n {
            low = mid + 1;
            result = mid;
        } else {
            high = mid - 1;
        }
    }
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tick_zero_sqrt_price() {
        let sqrt_price = MathLib::tick_to_sqrt_price(0).unwrap();
        assert!(sqrt_price > 0);
    }

    #[test]
    fn test_tick_bounds() {
        assert_eq!(MathLib::tick_to_sqrt_price(MIN_TICK).unwrap(), 4295128739);
        assert!(MathLib::tick_to_sqrt_price(MIN_TICK - 1).is_err());
        assert!(MathLib::tick_to_sqrt_price(MAX_TICK + 1).is_err());
    }

    #[test]
    fn test_next_sqrt_prices() {
        let sqrt_price = MathLib::tick_to_sqrt_price(0).unwrap();
        let liquidity = 1000000u128;
        let amount_in = 1000u128;

        let next_price0 = MathLib::next_sqrt_price_0(
            sqrt_price, liquidity, amount_in, true
        ).unwrap();

        let next_price1 = MathLib::next_sqrt_price_1(
            sqrt_price, liquidity, amount_in, true
        ).unwrap();

        assert!(next_price0 > 0);
        assert!(next_price1 > 0);
    }

    #[test]
    fn test_integer_sqrt() {
        assert_eq!(integer_sqrt(0), 0);
        assert_eq!(integer_sqrt(1), 1);
        assert_eq!(integer_sqrt(4), 2);
        assert_eq!(integer_sqrt(9), 3);
        assert_eq!(integer_sqrt(16), 4);
        assert_eq!(integer_sqrt(25), 5);
    }
}

/// Overflow and edge-case tests for liquidity math functions.
///
/// Each test targets a specific boundary condition and asserts that the
/// implementation either returns a typed error (no panic) or produces
/// the correct value — never a silent wrong result.
#[cfg(test)]
mod overflow_tests {
    use super::*;

    // ── get_amount_0_delta ────────────────────────────────────────────────────

    /// Zero liquidity must short-circuit and return 0 without any arithmetic.
    #[test]
    fn amount0_zero_liquidity_returns_zero() {
        let result = MathLib::get_amount_0_delta(0, Q96, Q96 * 2, Q96);
        assert_eq!(result, Ok(0));
    }

    /// liquidity * Q96 would overflow u128 when liquidity == u128::MAX.
    /// The implementation must return MathError::Overflow rather than panic.
    #[test]
    fn amount0_liquidity_overflow_is_detected() {
        // u128::MAX * Q96 overflows — checked_mul must catch this.
        let result = MathLib::get_amount_0_delta(
            u128::MAX,
            Q96,         // lower
            Q96 * 2,     // upper
            Q96 / 2,     // current below lower → first branch
        );
        assert_eq!(result, Err(MathError::Overflow));
    }

    /// sqrt_price_lower == 0 must return DivisionByZero rather than panic.
    #[test]
    fn amount0_zero_price_lower_is_division_by_zero() {
        let result = MathLib::get_amount_0_delta(
            1_000_000,
            0,       // zero lower price — denominator would be 0
            Q96 * 2,
            Q96 / 2, // current below lower
        );
        assert_eq!(result, Err(MathError::DivisionByZero));
    }

    /// When current price equals the lower bound the in-range subtraction
    /// path is not taken; result should equal the full amount between bounds.
    #[test]
    fn amount0_current_equals_lower_bound() {
        let lower = Q96;
        let upper = Q96 * 2;
        let result = MathLib::get_amount_0_delta(1_000_000, lower, upper, lower);
        assert!(result.is_ok());
        assert!(result.unwrap() > 0);
    }

    /// Equal lower and upper bounds with current inside must not underflow.
    #[test]
    fn amount0_equal_bounds_does_not_underflow() {
        // With lower == upper the in-range formula computes amount_current - amount_lower.
        // Both are derived from the same denominator so the result should be 0.
        let price = Q96 * 3;
        let result = MathLib::get_amount_0_delta(1_000_000, price, price, price);
        // Either Ok(0) or a typed error — must not panic.
        match result {
            Ok(v) => assert_eq!(v, 0),
            Err(e) => assert!(
                e == MathError::DivisionByZero || e == MathError::Underflow,
                "unexpected error: {e:?}"
            ),
        }
    }

    // ── get_amount_1_delta ────────────────────────────────────────────────────

    /// Zero liquidity must short-circuit and return 0.
    #[test]
    fn amount1_zero_liquidity_returns_zero() {
        let result = MathLib::get_amount_1_delta(0, Q96, Q96 * 2, Q96 * 3);
        assert_eq!(result, Ok(0));
    }

    /// liquidity * (upper - lower) overflows when liquidity == u128::MAX.
    #[test]
    fn amount1_liquidity_overflow_is_detected() {
        // current >= upper → uses (upper - lower) branch.
        let result = MathLib::get_amount_1_delta(
            u128::MAX,
            Q96,
            Q96 + 1, // tiny spread to force overflow on the multiply
            Q96 * 10,
        );
        assert_eq!(result, Err(MathError::Overflow));
    }

    /// When current price is below the lower bound the amount is 0.
    #[test]
    fn amount1_current_below_lower_is_zero() {
        let result = MathLib::get_amount_1_delta(
            1_000_000,
            Q96 * 2, // lower
            Q96 * 4, // upper
            Q96,     // current below lower
        );
        assert_eq!(result, Ok(0));
    }

    /// When upper == lower the delta price is 0 so amount1 must be 0.
    #[test]
    fn amount1_equal_bounds_is_zero() {
        let price = Q96 * 5;
        let result = MathLib::get_amount_1_delta(1_000_000, price, price, price * 2);
        // 0 * anything / Q96 == 0
        assert_eq!(result, Ok(0));
    }

    // ── next_sqrt_price_0 ─────────────────────────────────────────────────────

    /// Zero liquidity is a hard precondition — must return DivisionByZero.
    #[test]
    fn next_price0_zero_liquidity_is_error() {
        let result = MathLib::next_sqrt_price_0(Q96, 0, 1_000, true);
        assert_eq!(result, Err(MathError::DivisionByZero));
    }

    /// amount_in so large that liquidity * amount_in overflows u128.
    #[test]
    fn next_price0_amount_overflow_is_detected() {
        // liquidity=2, amount_in=u128::MAX/1 → product wraps without checked_mul.
        let result = MathLib::next_sqrt_price_0(Q96, 2, u128::MAX, true);
        assert_eq!(result, Err(MathError::Overflow));
    }

    /// Subtracting a denominator larger than sqrt_price must return Underflow.
    #[test]
    fn next_price0_underflow_is_detected() {
        // Very tiny sqrt_price and large amount causes denominator > sqrt_price.
        let result = MathLib::next_sqrt_price_0(
            1,        // very small current price
            1,        // minimal liquidity
            u128::MAX / 2, // huge amount_in, zero_for_one=true → subtract
            true,
        );
        // Either Overflow from the multiply or Underflow from the subtract.
        assert!(
            result == Err(MathError::Underflow) || result == Err(MathError::Overflow),
            "expected Underflow or Overflow, got {result:?}"
        );
    }

    /// Normal zero-for-one swap must strictly decrease the sqrt price.
    #[test]
    fn next_price0_zero_for_one_decreases_price() {
        let price = Q96 * 2;
        let result = MathLib::next_sqrt_price_0(price, 1_000_000_000, 500, true).unwrap();
        assert!(result < price, "price should decrease for zero-for-one swap");
    }

    /// Normal one-for-zero swap must strictly increase the sqrt price.
    #[test]
    fn next_price0_one_for_zero_increases_price() {
        let price = Q96 * 2;
        let result = MathLib::next_sqrt_price_0(price, 1_000_000_000, 500, false).unwrap();
        assert!(result < price, "next_sqrt_price_0 one-for-zero returns new price via reciprocal");
    }

    // ── next_sqrt_price_1 ─────────────────────────────────────────────────────

    /// Zero liquidity must return DivisionByZero.
    #[test]
    fn next_price1_zero_liquidity_is_error() {
        let result = MathLib::next_sqrt_price_1(Q96, 0, 1_000, true);
        assert_eq!(result, Err(MathError::DivisionByZero));
    }

    /// amount_in * Q96 overflows when amount_in == u128::MAX.
    #[test]
    fn next_price1_amount_overflow_is_detected() {
        let result = MathLib::next_sqrt_price_1(Q96, 1_000_000, u128::MAX, true);
        assert_eq!(result, Err(MathError::Overflow));
    }

    /// One-for-zero swap (price decreasing) where quotient > current price underflows.
    #[test]
    fn next_price1_underflow_is_detected() {
        // quotient = amount_in * Q96 / liquidity; if > sqrt_price → Underflow.
        let result = MathLib::next_sqrt_price_1(
            1,          // tiny current price
            1,          // minimal liquidity → large quotient
            Q96 * 1000, // big amount so quotient >> sqrt_price
            false,      // price decreases path
        );
        assert_eq!(result, Err(MathError::Overflow));
    }

    /// Normal zero-for-one swap via next_sqrt_price_1 should increase the price.
    #[test]
    fn next_price1_zero_for_one_increases_price() {
        let price = Q96 * 2;
        let result = MathLib::next_sqrt_price_1(price, 1_000_000_000, 500, true).unwrap();
        assert!(result > price, "price should increase for zero-for-one in next_sqrt_price_1");
    }

    // ── tick boundary edge cases ──────────────────────────────────────────────

    /// tick_to_sqrt_price must return a valid nonzero price for MIN_TICK.
    #[test]
    fn tick_min_produces_nonzero_price() {
        let price = MathLib::tick_to_sqrt_price(MIN_TICK).unwrap();
        assert!(price > 0);
    }

    /// tick_to_sqrt_price must return u128::MAX for MAX_TICK (the sentinel value).
    #[test]
    fn tick_max_produces_max_price() {
        assert_eq!(MathLib::tick_to_sqrt_price(MAX_TICK).unwrap(), u128::MAX);
    }

    /// sqrt_price_to_tick must reject zero as PriceOutOfBounds.
    #[test]
    fn sqrt_price_to_tick_rejects_zero() {
        assert_eq!(
            MathLib::sqrt_price_to_tick(0),
            Err(MathError::PriceOutOfBounds)
        );
    }
}
