import * as sdk from '../index';

// Source of truth: packages/sdk/src/index.ts
// Keep this list sorted. Adding or removing a value export from the barrel
// must be reflected here so the public API surface is a deliberate change.
const EXPECTED_EXPORTS = [
  'CONTRACT_ERROR_CODE_MAP',
  'DEFAULT_SWAP_DEADLINE_SECONDS',
  'EMPTY_EXACT_OUTPUT_QUOTE',
  'EMPTY_POSITION_MESSAGE',
  'EMPTY_QUOTE',
  'MAX_SWAP_DEADLINE_SECONDS',
  'QuoteValidationError',
  'SdkError',
  'SdkErrorCode',
  'SwapValidationError',
  'SwyftRpcError',
  'ValidationError',
  'buildAddLiquidityTx',
  'buildBurnTx',
  'buildCollectTx',
  'buildExactOutputSwapTx',
  'buildRerangeTx',
  'buildSwapTx',
  'calculateExactOutputQuote',
  'calculateSwapQuote',
  'config',
  'detectPoolType',
  'estimateRemoveAmounts',
  'estimateRemoveAmountsAsync',
  'getPool',
  'getPosition',
  'getPositionWithLoading',
  'getSwapQuote',
  'getTick',
  'isEmptyQuote',
  'mapContractError',
  'toRawAmount',
  'toStellarAddress',
  'toXdrBase64',
  'withContractErrorMapping',
];

describe('@swyft/sdk public API surface', () => {
  it('exposes exactly the expected runtime exports from the barrel', () => {
    expect(Object.keys(sdk).sort()).toEqual(EXPECTED_EXPORTS);
  });
});
