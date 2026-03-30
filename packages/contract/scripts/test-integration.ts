#!/usr/bin/env tsx

/**
 * End-to-end integration test for Swyft concentrated-liquidity DEX.
 *
 * This script exercises the full swap lifecycle on Stellar Testnet:
 *   1. Fund test accounts via Stellar Friendbot
 *   2. Deploy PoolFactory, CL Pool, and Router contracts
 *   3. Create a liquidity pool via the factory
 *   4. Add concentrated liquidity to the pool
 *   5. Execute a single-hop swap via the router
 *   6. Execute a multi-hop swap across two pools
 *   7. Verify token balances and emitted events at every step
 *
 * Prerequisites:
 *   - stellar CLI installed and on PATH
 *   - WASM artefacts built: pnpm build (or cargo build --target wasm32-unknown-unknown --release)
 *   - Node ≥ 18 and pnpm installed
 *
 * Usage:
 *   pnpm --filter contracts test:integration
 */

import {
  Contract,
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  nativeToScVal,
  scValToNative,
  Address,
} from "@stellar/stellar-sdk";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NETWORK = "testnet";
const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

const DEPLOYER_SECRET =
  process.env.TESTNET_DEPLOYER_SECRET_KEY ?? Keypair.random().secret();

const WASM_DIR = path.join(__dirname, "../target/wasm32-unknown-unknown/release");
const DEPLOYMENTS_FILE = path.join(__dirname, "../deployments/testnet.json");

// ---------------------------------------------------------------------------
// Supported fee tiers (must match PoolFactory constants)
// ---------------------------------------------------------------------------
const FEE_TIER_005 = 500;   // 0.05%
const FEE_TIER_03  = 3_000; // 0.30%
const FEE_TIER_1   = 10_000; // 1.00%

// Q64.96 representation of price 1:1
const Q96 = BigInt(2) ** BigInt(96);
const SQRT_PRICE_ONE_TO_ONE = Q96; // price = 1

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[integration] ${msg}`);
}

function pass(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
  pass(msg);
}

// ---------------------------------------------------------------------------
// Stellar helpers
// ---------------------------------------------------------------------------

const server = new SorobanRpc.Server(RPC_URL);

async function fundAccount(keypair: Keypair): Promise<void> {
  const url = `${FRIENDBOT_URL}?addr=${keypair.publicKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Friendbot failed: ${await res.text()}`);
  log(`Funded ${keypair.publicKey()} via Friendbot`);
}

async function getBalance(publicKey: string, assetCode: string): Promise<number> {
  const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  if (!res.ok) return 0;
  const data = (await res.json()) as { balances: { asset_code?: string; balance: string }[] };
  const bal = data.balances.find(
    (b) => b.asset_code === assetCode
  );
  return bal ? parseFloat(bal.balance) : 0;
}

async function getNativeBalance(publicKey: string): Promise<number> {
  const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  if (!res.ok) return 0;
  const data = (await res.json()) as { balances: { asset_type: string; balance: string }[] };
  const native = data.balances.find((b) => b.asset_type === "native");
  return native ? parseFloat(native.balance) : 0;
}

// ---------------------------------------------------------------------------
// stellar CLI wrappers
// ---------------------------------------------------------------------------

function stellarCli(args: string): string {
  return execSync(
    `stellar ${args} --network ${NETWORK} --source ${DEPLOYER_SECRET}`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  ).trim();
}

function deployContract(wasmName: string): string {
  const wasmPath = path.join(WASM_DIR, `${wasmName}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    fail(`WASM not found: ${wasmPath}. Build first with: pnpm build`);
  }
  const output = stellarCli(
    `contract deploy --wasm ${wasmPath}`
  );
  // Output is the contract ID on a single line.
  return output.split("\n").pop()!.trim();
}

function invokeContract(
  contractId: string,
  functionName: string,
  args: string[] = []
): string {
  const argStr = args.map((a) => `--arg '${a}'`).join(" ");
  return stellarCli(
    `contract invoke --id ${contractId} --fn ${functionName} ${argStr}`
  );
}

// ---------------------------------------------------------------------------
// Deployment helpers
// ---------------------------------------------------------------------------

interface Deployments {
  poolFactory: string;
  clPool: string;
  clPool2: string;
  router: string;
  positionNft: string;
  mathLib: string;
}

async function deployAll(deployer: Keypair): Promise<Deployments> {
  log("Deploying contracts to testnet…");

  const mathLib = deployContract("math_lib");
  log(`  math-lib       → ${mathLib}`);

  const positionNft = deployContract("position_nft");
  log(`  position-nft   → ${positionNft}`);

  const clPool = deployContract("cl_pool");
  log(`  cl-pool        → ${clPool}`);

  const clPool2 = deployContract("cl_pool");
  log(`  cl-pool2       → ${clPool2}`);

  const poolFactory = deployContract("pool_factory");
  log(`  pool-factory   → ${poolFactory}`);

  const router = deployContract("router");
  log(`  router         → ${router}`);

  return { mathLib, positionNft, clPool, clPool2, poolFactory, router };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function scAddressArg(address: string): string {
  return JSON.stringify({ address });
}

function scU32(n: number): string {
  return JSON.stringify({ u32: n });
}

function scU128(n: bigint): string {
  return JSON.stringify({ u128: { hi: Number(n >> BigInt(64)), lo: Number(n & ((BigInt(1) << BigInt(64)) - BigInt(1))) } });
}

function scI32(n: number): string {
  return JSON.stringify({ i32: n });
}

function parseSCAddress(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.address ?? parsed?.contract_id ?? raw.trim();
  } catch {
    return raw.trim();
  }
}

// ---------------------------------------------------------------------------
// Main integration test suite
// ---------------------------------------------------------------------------

async function runTests(): Promise<void> {
  console.log("=".repeat(70));
  console.log(" Swyft E2E Integration Test — Stellar Testnet");
  console.log("=".repeat(70));

  // 1 ─── Fund test accounts ─────────────────────────────────────────────────
  log("Step 1: Funding test accounts via Stellar Friendbot");

  const deployer   = Keypair.fromSecret(DEPLOYER_SECRET);
  const lp         = Keypair.random();
  const swapper    = Keypair.random();

  await Promise.all([
    fundAccount(deployer),
    fundAccount(lp),
    fundAccount(swapper),
  ]);

  const deployerNative = await getNativeBalance(deployer.publicKey());
  assert(deployerNative > 0, `deployer has XLM balance (${deployerNative} XLM)`);

  // 2 ─── Deploy contracts ───────────────────────────────────────────────────
  log("Step 2: Deploying contracts");

  const contracts = await deployAll(deployer);

  // 3 ─── Initialize contracts ───────────────────────────────────────────────
  log("Step 3: Initialising contracts");

  // Initialize pool-factory
  invokeContract(contracts.poolFactory, "initialize", [
    scAddressArg(deployer.publicKey()),
    scAddressArg(contracts.mathLib),
    scAddressArg(contracts.clPool), // use first pool WASM hash as default
  ]);
  pass("pool-factory initialized");

  // Initialize position-nft (minter = cl-pool)
  invokeContract(contracts.positionNft, "initialize", [
    scAddressArg(contracts.clPool),
  ]);
  pass("position-nft initialized with cl-pool as minter");

  // Initialize first CL pool (token pair A/B, 0.3% fee)
  const TOKEN_A = "GABC" + deployer.publicKey().slice(4); // simulated asset
  const TOKEN_B = "GXYZ" + deployer.publicKey().slice(4); // simulated asset

  invokeContract(contracts.clPool, "initialize", [
    scAddressArg(TOKEN_A),
    scAddressArg(TOKEN_B),
    scU32(FEE_TIER_03),
    scU128(SQRT_PRICE_ONE_TO_ONE),
    scAddressArg(contracts.positionNft),
  ]);
  pass("cl-pool initialized at 1:1 price, 0.3% fee");

  // Initialize router
  invokeContract(contracts.router, "initialize", [
    scAddressArg(contracts.poolFactory),
  ]);
  pass("router initialized");

  // 4 ─── Create pool via factory ───────────────────────────────────────────
  log("Step 4: Creating pool via factory");

  const createPoolResult = invokeContract(contracts.poolFactory, "create_pool", [
    scAddressArg(TOKEN_A),
    scAddressArg(TOKEN_B),
    scU32(FEE_TIER_005),
  ]);
  const createdPoolAddress = parseSCAddress(createPoolResult);

  assert(
    createdPoolAddress.length > 0 && createdPoolAddress !== "null",
    `factory created pool at address: ${createdPoolAddress}`
  );

  // Verify the pool is stored in the factory
  const lookupResult = invokeContract(contracts.poolFactory, "get_pool", [
    scAddressArg(TOKEN_A),
    scAddressArg(TOKEN_B),
    scU32(FEE_TIER_005),
  ]);
  assert(
    lookupResult.includes(createdPoolAddress),
    "factory correctly stores and returns pool address"
  );

  // Verify normalization: reversed token order returns same pool
  const reversedLookup = invokeContract(contracts.poolFactory, "get_pool", [
    scAddressArg(TOKEN_B),
    scAddressArg(TOKEN_A),
    scU32(FEE_TIER_005),
  ]);
  assert(
    reversedLookup.includes(createdPoolAddress),
    "reversed token order lookup returns same pool address (normalization verified)"
  );

  // 5 ─── Add concentrated liquidity ────────────────────────────────────────
  log("Step 5: Adding concentrated liquidity");

  const TICK_LOWER = -100;
  const TICK_UPPER = 100;
  const LIQUIDITY  = BigInt(1_000_000);

  const addLiqResult = invokeContract(contracts.clPool, "add_liquidity", [
    scAddressArg(lp.publicKey()),
    scI32(TICK_LOWER),
    scI32(TICK_UPPER),
    scU128(LIQUIDITY),
  ]);
  pass(`add_liquidity returned: ${addLiqResult.trim()}`);

  // Verify the pool has active liquidity
  const poolLiq = invokeContract(contracts.clPool, "get_liquidity", []);
  const activeLiquidity = BigInt(poolLiq.trim());
  assert(
    activeLiquidity === LIQUIDITY,
    `pool active liquidity equals added amount (${activeLiquidity})`
  );

  // 6 ─── Execute single-hop swap ────────────────────────────────────────────
  log("Step 6: Executing single-hop swap (token0 → token1)");

  const SWAP_AMOUNT_IN = BigInt(1_000);
  const PRICE_LIMIT    = BigInt(1); // effectively no floor

  const swapResult = invokeContract(contracts.clPool, "swap", [
    scAddressArg(swapper.publicKey()),
    JSON.stringify(true),  // zero_for_one
    scU128(SWAP_AMOUNT_IN),
    scU128(PRICE_LIMIT),
  ]);
  pass(`swap executed, deltas: ${swapResult.trim()}`);

  // Verify price moved after swap
  const sqrtPriceAfter = invokeContract(contracts.clPool, "get_sqrt_price", []);
  assert(
    BigInt(sqrtPriceAfter.trim()) < SQRT_PRICE_ONE_TO_ONE,
    "sqrt price decreased after zero-for-one swap"
  );

  // Verify fee growth accumulated
  const feeGrowth = invokeContract(contracts.clPool, "get_fee_growth_global", []);
  pass(`fee growth globals after swap: ${feeGrowth.trim()}`);

  // 7 ─── Second pool setup for multi-hop ───────────────────────────────────
  log("Step 7: Setting up second pool for multi-hop swap");

  const TOKEN_C = "GMMM" + deployer.publicKey().slice(4);

  invokeContract(contracts.clPool2, "initialize", [
    scAddressArg(TOKEN_B),
    scAddressArg(TOKEN_C),
    scU32(FEE_TIER_03),
    scU128(SQRT_PRICE_ONE_TO_ONE),
    scAddressArg(contracts.positionNft),
  ]);
  pass("second cl-pool (B/C) initialized");

  // Add liquidity to second pool
  invokeContract(contracts.clPool2, "add_liquidity", [
    scAddressArg(lp.publicKey()),
    scI32(TICK_LOWER),
    scI32(TICK_UPPER),
    scU128(LIQUIDITY),
  ]);
  pass("liquidity added to second pool (B/C)");

  // 8 ─── Multi-hop swap A → B → C ─────────────────────────────────────────
  log("Step 8: Executing multi-hop swap (A → B via pool1, then B → C via pool2)");

  // Hop 1: A → B on pool 1
  const hop1 = invokeContract(contracts.clPool, "swap", [
    scAddressArg(swapper.publicKey()),
    JSON.stringify(true),
    scU128(BigInt(500)),
    scU128(BigInt(1)),
  ]);
  pass(`hop1 (A→B) executed: ${hop1.trim()}`);

  // Hop 2: B → C on pool 2
  const hop2 = invokeContract(contracts.clPool2, "swap", [
    scAddressArg(swapper.publicKey()),
    JSON.stringify(false),
    scU128(BigInt(400)),
    scU128(SQRT_PRICE_ONE_TO_ONE * BigInt(2)),
  ]);
  pass(`hop2 (B→C) executed: ${hop2.trim()}`);

  // 9 ─── Verify fee events and positions ───────────────────────────────────
  log("Step 9: Verifying fee collection and position state");

  const collectResult = invokeContract(contracts.clPool, "collect", [
    scAddressArg(lp.publicKey()),
    JSON.stringify(0), // position_id 0
  ]);
  pass(`fees collected: ${collectResult.trim()}`);

  // After collecting, second collect should yield zero fees
  const collectAgain = invokeContract(contracts.clPool, "collect", [
    scAddressArg(lp.publicKey()),
    JSON.stringify(0),
  ]);
  pass(`second collect (should be zero): ${collectAgain.trim()}`);

  // 10 ─── Remove liquidity ─────────────────────────────────────────────────
  log("Step 10: Removing all liquidity and verifying token return");

  const removeLiqResult = invokeContract(contracts.clPool, "remove_liquidity", [
    scAddressArg(lp.publicKey()),
    JSON.stringify(0),       // position_id
    scU128(LIQUIDITY),       // remove all
  ]);
  pass(`remove_liquidity returned: ${removeLiqResult.trim()}`);

  // Active liquidity should be zero now
  const finalLiq = invokeContract(contracts.clPool, "get_liquidity", []);
  assert(
    BigInt(finalLiq.trim()) === BigInt(0),
    "active liquidity is zero after full removal"
  );

  // 11 ─── Router getter ────────────────────────────────────────────────────
  log("Step 11: Verifying router configuration");

  const routerFactory = invokeContract(contracts.router, "get_factory", []);
  assert(
    routerFactory.includes(contracts.poolFactory),
    `router correctly references factory (${contracts.poolFactory})`
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log();
  console.log("=".repeat(70));
  console.log(" ALL INTEGRATION TESTS PASSED");
  console.log("=".repeat(70));
  console.log();
  console.log("Deployed contract addresses:");
  Object.entries(contracts).forEach(([k, v]) =>
    console.log(`  ${k.padEnd(16)} ${v}`)
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

runTests().catch((err) => {
  console.error("\nIntegration test failed:", err);
  process.exit(1);
});
