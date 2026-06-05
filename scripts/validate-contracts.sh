#!/bin/bash
# Validate that all Swyft contracts compile successfully

set -e

CONTRACTS=(
  "hello-world"
  "math-lib"
  "pool"
  "pool-factory"
  "router"
  "position-nft"
  "fee-collector"
  "oracle-adapter"
  "cl-pool"
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Validating Swyft contracts...${NC}\n"

PASSED=0
FAILED=0

for contract in "${CONTRACTS[@]}"; do
  echo -n "Building $contract... "

  if cd "packages/contract/contracts/$contract" && \
     cargo build --target wasm32-unknown-unknown --release 2>/dev/null && \
     cd - > /dev/null; then
    echo -e "${GREEN}✓${NC}"
    ((PASSED++))
  else
    echo -e "${RED}✗${NC}"
    ((FAILED++))
  fi
done

echo ""
echo -e "${GREEN}Passed: $PASSED/${#CONTRACTS[@]}${NC}"
if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Failed: $FAILED/${#CONTRACTS[@]}${NC}"
  exit 1
fi

echo -e "\n${GREEN}All Swyft contracts validated!${NC}"
