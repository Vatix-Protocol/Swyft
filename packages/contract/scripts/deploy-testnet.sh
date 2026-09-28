#!/usr/bin/env bash
# deploy-testnet.sh — Deploy all Swyft contracts to Stellar testnet in dependency order.
# Usage: ./scripts/deploy-testnet.sh [--force]
set -euo pipefail

NETWORK="testnet"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
RPC_URL="https://soroban-testnet.stellar.org"
FRIENDBOT_URL="https://friendbot.stellar.org"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOYMENTS_DIR="$CONTRACTS_DIR/deployments"
TESTNET_JSON="$DEPLOYMENTS_DIR/testnet.json"
WASM_DIR="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release"
FORCE=false

for arg in "$@"; do
  [[ "$arg" == "--force" ]] && FORCE=true
done

# ── Helpers ──────────────────────────────────────────────────────────────────

##
# log() — Print an informational deploy message to stderr.
# @param $* Message text.
##
log()  { echo "[deploy] $*" >&2; }

##
# ok() — Print a success message to stderr.
# @param $* Message text.
##
ok()   { echo "[  ok  ] $*" >&2; }

##
# skip() — Print a skip message to stderr (contract already deployed).
# @param $* Message text.
##
skip() { echo "[ skip ] $*" >&2; }

##
# fail() — Print an error message to stderr and exit with status 1.
# @param $* Error message text.
##
fail() { echo "[error] $*" >&2; exit 1; }

##
# require_cmd() — Assert that a CLI command is available on PATH.
# Calls fail() and exits if the command is not found.
# @param $1 Command name to check (e.g. "stellar", "jq").
##
require_cmd() { command -v "$1" &>/dev/null || fail "'$1' not found. Install it first."; }
require_cmd stellar
require_cmd curl
require_cmd jq

mkdir -p "$DEPLOYMENTS_DIR"

# ── Deployer identity ─────────────────────────────────────────────────────────

IDENTITY="swyft-deployer"
if ! stellar keys show "$IDENTITY" &>/dev/null; then
  log "Generating deployer identity '$IDENTITY'..."
  stellar keys generate "$IDENTITY" --network "$NETWORK"
fi
DEPLOYER_ADDRESS=$(stellar keys address "$IDENTITY")
log "Deployer: $DEPLOYER_ADDRESS"

# ── Friendbot funding ─────────────────────────────────────────────────────────

##
# fund_if_needed() — Fund the deployer account via Stellar Friendbot if the
# XLM balance is below 10 XLM. No-ops when the balance is sufficient.
# Uses the global DEPLOYER_ADDRESS, NETWORK, and FRIENDBOT_URL variables.
# @return 0 on success; calls fail() and exits on Friendbot error.
##
fund_if_needed() {
  local balance
  balance=$(stellar account balance "$DEPLOYER_ADDRESS" --network "$NETWORK" 2>/dev/null | grep XLM | awk '{print $1}' || echo "0")
  # Treat balance < 10 XLM as insufficient
  if (( $(echo "$balance < 10" | bc -l 2>/dev/null || echo 1) )); then
    log "Balance low ($balance XLM). Funding via Friendbot..."
    curl -sf "$FRIENDBOT_URL?addr=$DEPLOYER_ADDRESS" -o /dev/null \
      || fail "Friendbot funding failed. Check network connectivity."
    ok "Funded via Friendbot."
  else
    ok "Balance sufficient ($balance XLM). Skipping Friendbot."
  fi
}
fund_if_needed

# ── Build all contracts ───────────────────────────────────────────────────────

log "Building contracts (release)..."
(cd "$CONTRACTS_DIR" && stellar contract build)
ok "Build complete."

# ── State helpers (read/write testnet.json) ───────────────────────────────────

##
# read_address() — Read a deployed contract address from testnet.json.
# @param $1 key  Contract key (e.g. "mathLib", "poolFactory").
# @return        The contract address string, or empty string if not found.
##
read_address() {
  local key="$1"
  if [[ -f "$TESTNET_JSON" ]]; then
    jq -r --arg k "$key" '.contracts[$k] // empty' "$TESTNET_JSON"
  fi
}

##
# wasm_hash() — sha256 hex digest of a compiled .wasm file. Recorded per
# contract so validate-contracts.js can later detect address drift (a
# deployed contract whose source has changed since it was deployed).
# @param $1 wasm  Path to the .wasm file.
##
wasm_hash() {
  if command -v sha256sum &>/dev/null; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

##
# update_manifest() — Atomically update the deployment manifest with jq.
# The temporary file is created alongside the manifest so the final rename
# stays on the same filesystem.
# @param $1 jq filter; remaining arguments are passed through to jq.
##
update_manifest() {
  local filter="$1"
  shift

  local tmp
  tmp=$(mktemp "${TESTNET_JSON}.tmp.XXXXXX") || fail "Could not create a manifest temp file."
  if ! jq "$@" "$filter" "$TESTNET_JSON" > "$tmp"; then
    rm -f "$tmp"
    fail "Could not update deployment manifest: $TESTNET_JSON"
  fi
  if ! mv "$tmp" "$TESTNET_JSON"; then
    rm -f "$tmp"
    fail "Could not replace deployment manifest: $TESTNET_JSON"
  fi
}

##
# write_address() — Persist a deployed contract address to testnet.json.
# Creates the file with an empty manifest if it does not exist.
# Also records the UTC deployment timestamp under .deployedAt[$key] and the
# deployed wasm's sha256 hash under .wasmHashes[$key] (see wasm_hash()).
# @param $1 key   Contract key (e.g. "mathLib", "poolFactory").
# @param $2 addr  Soroban contract ID returned by `stellar contract deploy`.
# @param $3 wasm  Path to the .wasm file that was deployed.
##
write_address() {
  local key="$1" addr="$2" wasm="$3" ts hash
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  hash=$(wasm_hash "$wasm")
  [[ "$hash" =~ ^[[:xdigit:]]{64}$ ]] || fail "Invalid SHA-256 hash for $key: $hash"

  if [[ ! -f "$TESTNET_JSON" ]]; then
    printf '%s\n' '{"network":"testnet","contracts":{},"deployedAt":{},"wasmHashes":{}}' > "$TESTNET_JSON"
  fi
  update_manifest \
    '.contracts[$k] = $v | .deployedAt[$k] = $t | .wasmHashes[$k] = $h' \
    --arg k "$key" --arg v "$addr" --arg t "$ts" --arg h "$hash"
}

# ── Deploy + verify one contract ──────────────────────────────────────────────

##
# deploy_contract() — Deploy a single Soroban contract and verify it on-chain.
#
# If the contract key already exists in testnet.json and --force was not
# passed, the function skips deployment and echoes the existing address.
# On success the contract address is written to testnet.json and echoed to
# stdout so callers can capture it with $(...).
#
# @param $1 key         Logical contract name used as the JSON key
#                       (e.g. "mathLib", "poolFactory").
# @param $2 wasm_name   Base name of the compiled WASM file without extension
#                       (e.g. "math_lib", "pool_factory").
# @param $3 verify_fn   Name of a read-only contract function to invoke as a
#                       post-deploy smoke test (e.g. "name").
# @return               Echoes the deployed contract ID (Soroban address).
#                       Calls fail() and exits on any error.
##
# deploy_contract <key> <wasm_name> <verify_fn>
deploy_contract() {
  local key="$1" wasm_name="$2" verify_fn="$3"
  local wasm="$WASM_DIR/${wasm_name}.wasm"

  [[ -f "$wasm" ]] || fail "WASM not found: $wasm"

  local existing
  existing=$(read_address "$key")

  if [[ -n "$existing" && "$FORCE" == false ]]; then
    skip "$key already deployed at $existing — use --force to redeploy."
    echo "$existing"
    return
  fi

  log "Deploying $key..."
  local contract_id
  contract_id=$(stellar contract deploy \
    --wasm "$wasm" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    2>&1 | tail -1)

  [[ -z "$contract_id" ]] && fail "Deploy of $key returned empty contract ID."

  # Post-deploy verification: invoke the read function
  log "Verifying $key ($verify_fn)..."
  stellar contract invoke \
    --id "$contract_id" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- "$verify_fn" &>/dev/null \
    || fail "Post-deploy verification failed for $key (fn: $verify_fn)."

  write_address "$key" "$contract_id" "$wasm"
  ok "$key deployed and verified: $contract_id"
  echo "$contract_id"
}

# ── Deployment order: math-lib → pool-factory → pool → cl-pool → router → position-nft → fee-collector → oracle-adapter

MATH_LIB_ID=$(deploy_contract    "mathLib"       "math_lib"       "name")
FACTORY_ID=$(deploy_contract     "poolFactory"   "pool_factory"   "name")
POOL_ID=$(deploy_contract        "pool"          "pool"           "name")
CL_POOL_ID=$(deploy_contract     "clPool"        "cl_pool"        "name")
ROUTER_ID=$(deploy_contract      "router"        "router"         "name")
POSITION_NFT_ID=$(deploy_contract "positionNft"  "position_nft"   "name")
FEE_COLLECTOR_ID=$(deploy_contract "feeCollector" "fee_collector"  "name")
# Each pool gets its own oracle-adapter instance — one adapter registers a
# single pool (the only address allowed to write observations).
ORACLE_ADAPTER_ID=$(deploy_contract "oracleAdapter" "oracle_adapter" "name")
CL_POOL_ORACLE_ADAPTER_ID=$(deploy_contract "clPoolOracleAdapter" "oracle_adapter" "name")

# ── Oracle wiring ──────────────────────────────────────────────────────────────
# Wire each pool to its adapter: oracle.initialize(pool) registers the pool as
# the only writer, and pool.set_oracle(adapter) makes the pool record a
# post-swap observation on every swap. Do this before the pools serve swaps.
log "Wiring oracle adapters to pools..."
invoke() {
  # invoke <contract_id> <fn> <arg-name> <arg-value>
  stellar contract invoke \
    --id "$1" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- "$2" --"$3" "$4" \
    || fail "Oracle wiring step failed: $1.$2($3=$4)"
}

invoke "$ORACLE_ADAPTER_ID" "initialize" "pool" "$POOL_ID"
invoke "$POOL_ID" "set_oracle" "oracle" "$ORACLE_ADAPTER_ID"
invoke "$CL_POOL_ORACLE_ADAPTER_ID" "initialize" "pool" "$CL_POOL_ID"
invoke "$CL_POOL_ID" "set_oracle" "oracle" "$CL_POOL_ORACLE_ADAPTER_ID"
ok "Oracle adapters wired to pool and cl-pool."

# ── Write final manifest ──────────────────────────────────────────────────────

# Stamp the deployer address into the manifest.
update_manifest '.deployer = $d' --arg d "$DEPLOYER_ADDRESS"

ok "All contracts deployed. Manifest written to: $TESTNET_JSON"
echo ""
echo "Contract addresses:"
jq '.contracts' "$TESTNET_JSON"
