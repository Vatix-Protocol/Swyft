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
# log() — Print an informational deploy message to stdout.
# @param $* Message text.
##
log()  { echo "[deploy] $*"; }

##
# ok() — Print a success message to stdout.
# @param $* Message text.
##
ok()   { echo "[  ok  ] $*"; }

##
# skip() — Print a skip message to stdout (contract already deployed).
# @param $* Message text.
##
skip() { echo "[ skip ] $*"; }

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
# write_address() — Persist a deployed contract address to testnet.json.
# Creates the file with an empty manifest if it does not exist.
# Also records the UTC deployment timestamp under .deployedAt[$key].
# @param $1 key   Contract key (e.g. "mathLib", "poolFactory").
# @param $2 addr  Soroban contract ID returned by `stellar contract deploy`.
##
write_address() {
  local key="$1" addr="$2" ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  if [[ ! -f "$TESTNET_JSON" ]]; then
    echo '{"network":"testnet","contracts":{},"deployedAt":{}}' > "$TESTNET_JSON"
  fi
  local tmp
  tmp=$(mktemp)
  jq --arg k "$key" --arg v "$addr" --arg t "$ts" \
    '.contracts[$k] = $v | .deployedAt[$k] = $t' \
    "$TESTNET_JSON" > "$tmp" && mv "$tmp" "$TESTNET_JSON"
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

  write_address "$key" "$contract_id"
  ok "$key deployed and verified: $contract_id"
  echo "$contract_id"
}

# ── Deployment order: math-lib → pool-factory → router → position-nft → fee-collector → oracle-adapter

MATH_LIB_ID=$(deploy_contract    "mathLib"       "math_lib"       "name")
FACTORY_ID=$(deploy_contract     "poolFactory"   "pool_factory"   "name")
ROUTER_ID=$(deploy_contract      "router"        "router"         "name")
POSITION_NFT_ID=$(deploy_contract "positionNft"  "position_nft"   "name")
FEE_COLLECTOR_ID=$(deploy_contract "feeCollector" "fee_collector"  "name")
ORACLE_ADAPTER_ID=$(deploy_contract "oracleAdapter" "oracle_adapter" "name")

# ── Write final manifest ──────────────────────────────────────────────────────

# Stamp the deployer address into the manifest
tmp=$(mktemp)
jq --arg d "$DEPLOYER_ADDRESS" '.deployer = $d' "$TESTNET_JSON" > "$tmp" && mv "$tmp" "$TESTNET_JSON"

ok "All contracts deployed. Manifest written to: $TESTNET_JSON"
echo ""
echo "Contract addresses:"
jq '.contracts' "$TESTNET_JSON"
