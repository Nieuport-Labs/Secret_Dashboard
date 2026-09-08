/**
 * Secret Network mainnet configuration.
 *
 * The single source of truth about the chain. Nothing chain-specific belongs in
 * a module-level constant anywhere else — endpoint resolution, localStorage
 * keys, explorer links and contract addresses all read from here, so that
 * adding a second chain later is a change to this file rather than a hunt.
 */

export const CHAIN_ID = 'secret-4'
export const CHAIN_NAME = 'Secret Network'

export const DENOM = 'uscrt'
export const DISPLAY_DENOM = 'SCRT'
export const DECIMALS = 6
export const BECH32_PREFIX = 'secret'
/** Same key, different hat: an account's validator and consensus spellings. */
export const BECH32_VALOPER_PREFIX = 'secretvaloper'
export const BECH32_VALCONS_PREFIX = 'secretvalcons'

/**
 * Gas price used to turn a gas limit into a fee amount, and passed to the
 * signing library unchanged.
 *
 * Nodes report a `minimum_gas_price` of 0.0125 uscrt and the chain registry
 * calls 0.05 the fixed minimum, so 0.1 is generous on purpose. The estimate
 * handed to `selectFeeGrant` must be at least what is actually paid: estimating
 * low makes a grant look able to cover a transaction it then fails, which is
 * the one failure the fee-grant SDK cannot recover from. Estimating high only
 * risks judging a grant insufficient when it would have paid — which falls back
 * to the wallet's own balance, and is safe. Per-validator minimums vary too,
 * and 0.1 clears all of them. See docs/chain-facts.md.
 */
export const GAS_PRICE_USCRT = 0.1

/** Gas limits, sized per message rather than one pessimistic number. */
export const GAS = {
  send: 25_000,
  snip20Transfer: 60_000,
  wrap: 60_000,
  unwrap: 60_000,
  setViewingKey: 60_000,
  revokePermit: 40_000,
  delegate: 250_000,
  undelegate: 250_000,
  redelegate: 300_000,
  claimRewards: 90_000,
  /** Per validator, added on top of a base. */
  setAutoRestake: 60_000,
  ibcTransfer: 150_000,
  /** A vote writes one record and re-reads the voter's delegations to weight it. */
  vote: 120_000,
  /** Validator operations. Each rewrites one record the staking module owns. */
  editValidator: 150_000,
  withdrawCommission: 150_000,
  unjail: 150_000,
  /**
   * Added on top of the inner message when sending one under an authz grant.
   * The wrapper costs a grant lookup and a second round of message routing.
   */
  authzExec: 50_000,
  /** Vault execute plus the grant it issues (and a revoke when topping up). */
  buyGasCredit: 400_000,
  grantAllowance: 100_000,
  revokeAllowance: 80_000
} as const

/**
 * Endpoint candidates. Probed in order; the first that answers with JSON *and*
 * reports this chain id wins. A dead public node usually answers at the HTTP
 * level with an HTML error page, which surfaces as `Unexpected token '<'` from
 * deep inside secretjs — hence probing rather than trusting.
 *
 * Settings can override these at runtime with a comma-separated list.
 */
export const DEFAULT_LCD_URLS = [
  'https://lcd-secret.keplr.app',
  'https://rest.lavenderfive.com:443/secretnetwork',
  'https://secretnetwork-api.lavenderfive.com'
]

/** Tendermint RPC. Needed for IBC broadcasts and for SNIP-52 WebSocket events. */
export const DEFAULT_RPC_URLS = [
  'https://rpc-secret.keplr.app',
  'https://rpc.lavenderfive.com:443/secretnetwork'
]

export const EXPLORER_TX_TEMPLATE = 'https://www.mintscan.io/secret/tx/{hash}'
export const EXPLORER_ACCOUNT_TEMPLATE = 'https://www.mintscan.io/secret/address/{address}'
export const EXPLORER_VALIDATOR_TEMPLATE = 'https://www.mintscan.io/secret/validators/{address}'

/**
 * Gas vault contract (`contracts/gas-vault` in jirkacepelka/fee-granter). Pay
 * SCRT in with a grantee address and the contract issues that address a fee
 * allowance of the same size, payable from the contract rather than from you.
 *
 * Verified live by `scripts/verify-chain.ts` — see docs/chain-facts.md.
 */
export const GAS_VAULT_ADDRESS = 'secret1kkmu4vydkppkhzmx00glm20vn47t09544adv0g'

/**
 * IBC-hooks wrapper that wraps an arriving ICS-20 deposit into its SNIP-20
 * equivalent. Targeted by the `wasm` memo on an incoming transfer.
 */
export const IBC_HOOKS_WRAPPER = 'secret198lmmh2fpj3weqhjczptkzl9pxygs23yn6dsev'

export function explorerTxUrl(hash: string): string {
  return EXPLORER_TX_TEMPLATE.replace('{hash}', hash)
}

export function explorerAccountUrl(address: string): string {
  return EXPLORER_ACCOUNT_TEMPLATE.replace('{address}', address)
}

export function explorerValidatorUrl(address: string): string {
  return EXPLORER_VALIDATOR_TEMPLATE.replace('{address}', address)
}

/** Named separately because the copied fee-grant modules expect these spellings. */
export const GAS_GRANT = GAS.grantAllowance
export const GAS_REVOKE = GAS.revokeAllowance
