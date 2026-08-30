# Testnet deployments registry

Canonical registry for Stellar **testnet** contract IDs used by the web app and API.

## Source of truth

[`packages/contract/deployments/testnet.json`](../packages/contract/deployments/testnet.json)

Populate by running:

```bash
pnpm --filter contracts deploy:testnet
```

## Contract keys → env vars

| Registry key (`contracts.*`) | Env var                         | Notes                          |
| ---------------------------- | ------------------------------- | ------------------------------ |
| `mathLib`                    | `MATH_LIB_CONTRACT_ID`          | Fixed-point math library       |
| `poolFactory`                | `POOL_FACTORY_CONTRACT_ID`      | Pool factory                   |
| `pool`                       | `POOL_CONTRACT_ID`              | Primary pool (API indexer)     |
| `clPool`                     | `CL_POOL_CONTRACT_ID`           | CL pool implementation         |
| `router`                     | `ROUTER_CONTRACT_ID`            | Swap router                    |
| `positionNft`                | `POSITION_NFT_CONTRACT_ID`      | LP position NFTs               |
| `feeCollector`               | `FEE_COLLECTOR_CONTRACT_ID`     | Protocol fee collector         |
| `oracleAdapter`              | `ORACLE_ADAPTER_CONTRACT_ID`    | TWAP oracle for `pool`         |
| `clPoolOracleAdapter`        | `CL_POOL_ORACLE_ADAPTER_CONTRACT_ID` | TWAP oracle for `clPool` |

Empty strings mean “not yet deployed”. After deploy, IDs are `C…` Soroban contract addresses.

See also: [CONTRACTS.md](../CONTRACTS.md), `apps/api/.env.example`.
