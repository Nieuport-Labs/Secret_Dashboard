import { useEffect, useMemo, useState, type ReactNode } from 'react'

import AmountField from '@/components/ui/AmountField'
import Picker, { type PickerOption } from '@/components/ui/Picker'
import StakeProposal from '@/pages/multisig/components/StakeProposal'
import { DECIMALS, DISPLAY_DENOM } from '@/chains/secret4'
import { useAccountStaking } from '@/hooks/useAccountStaking'
import { isValidBech32 } from '@/lib/bech32'
import { BECH32_PREFIX } from '@/chains/secret4'
import { formatAmount } from '@/lib/format'
import * as compose from '@/lib/multisig/compose'
import type { MultisigConfig } from '@/lib/multisig/config'
import type { DeclaredMsg } from '@/lib/multisig/messages'
import { generateViewingKey } from '@/lib/snip20'
import { allTokens, SSCRT_ADDRESS, tokenImageUrl, tokenByAddress } from '@/tokens/registry'
import { bankDenomFor } from '@/tokens/routes'

/**
 * The forms behind each kind of proposal.
 *
 * Written as forms rather than as a JSON editor because the editor was asking
 * the wrong thing of people. Composing `{"from_address":…,"amount":"10000000uscrt"}`
 * by hand means knowing the field names, the base units and the denomination
 * spelling, and getting any of the three wrong produces either a refusal from
 * the chain or — worse — a valid transaction that does something other than
 * what was meant. A field labelled "Amount" with SCRT beside it cannot make
 * that mistake.
 *
 * The raw editor is still there under Advanced, and still the only way to
 * reach a contract this app has no form for. What changed is that it is no
 * longer the price of doing something ordinary.
 *
 * Staking is the exception that proves the rule: it has no form here at all,
 * because the app already has a good one. `StakeProposal` opens the staking
 * screen's own dialog and turns what it collects into a message — one place
 * where the group decides how much to delegate and to whom, whether the
 * account doing it holds one key or five.
 *
 * Every form's output goes through `describeMessage` for the preview above the
 * button, so the person composing sees the same sentence the people reviewing
 * will see. A form that produces a summary its author does not recognise is a
 * form filled in wrong, and that is worth finding before a signing round
 * rather than during one.
 */

export type ActionKind =
  | 'send'
  | 'wrap'
  | 'unwrap'
  | 'stake'
  | 'unstake'
  | 'redelegate'
  | 'claim'
  | 'vote'
  | 'viewing-key'
  | 'fee-grant'
  | 'fee-revoke'

/**
 * `onMessages` and `onSuggestTitle` are the composer's own state setters,
 * whose identity React guarantees is stable — so every effect below can depend
 * on them honestly instead of pretending they do not exist.
 */
interface FormProps {
  config: MultisigConfig
  /** Called on every edit with what the proposal would carry — empty while incomplete. */
  onMessages: (messages: DeclaredMsg[]) => void
  /** A title the composer may adopt while the person has not written their own. */
  onSuggestTitle: (title: string) => void
  /**
   * Handed over from elsewhere in the app: a vote from the governance screen,
   * or the token whose row on the overview was the reason somebody came here.
   */
  initial?: { proposalId?: string; option?: string; asset?: string; contract?: string }
}

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                               */
/* -------------------------------------------------------------------------- */

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-text-muted">{label}</span>
      {children}
      {hint ? <span className="text-label text-text-faint">{hint}</span> : null}
    </label>
  )
}

function AddressInput({
  value,
  onChange,
  placeholder = 'secret1…'
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const malformed = value.trim().length > 0 && !isValidBech32(value.trim(), BECH32_PREFIX)

  return (
    <>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
      />
      {malformed ? (
        // The checksum is the point of bech32: a mistyped address is refused
        // here rather than accepted as some other account nobody holds.
        <span className="text-label text-negative">That is not a valid {BECH32_PREFIX} address.</span>
      ) : null}
    </>
  )
}

/** Tokens that wrap a bank denomination, which is what wrapping and unwrapping need. */
function wrappableTokens() {
  return allTokens().filter((token) => bankDenomFor(token.address))
}

function tokenOptions(tokens: ReturnType<typeof allTokens>): PickerOption[] {
  return tokens.map((token) => ({
    id: token.address,
    label: token.address === SSCRT_ADDRESS ? 'sSCRT' : token.symbol,
    detail: token.description,
    image: tokenImageUrl(token)
  }))
}

/* -------------------------------------------------------------------------- */
/* Send                                                                        */
/* -------------------------------------------------------------------------- */

const NATIVE = 'native'

function SendForm({ config, onMessages, onSuggestTitle, initial }: FormProps) {
  // Whatever row was clicked to get here, when one was — `native`, or a
  // contract address. A `bank:<denom>` row has no send route of its own yet,
  // so anything unrecognised falls back to the native coin.
  const [asset, setAsset] = useState(
    initial?.asset && (initial.asset === NATIVE || tokenByAddress(initial.asset)) ? initial.asset : NATIVE
  )
  const [amount, setAmount] = useState('')
  const [to, setTo] = useState('')

  const token = asset === NATIVE ? undefined : tokenByAddress(asset)

  useEffect(() => {
    const ready = amount && Number(amount) > 0 && isValidBech32(to.trim(), BECH32_PREFIX)
    if (!ready) return onMessages([])

    onMessages([
      asset === NATIVE
        ? compose.sendNative({ from: config.address, to, amount })
        : compose.sendToken({ from: config.address, to, contract: asset, amount })
    ])
    onSuggestTitle(`Send ${amount} ${token ? token.symbol : DISPLAY_DENOM}`)
  }, [asset, amount, to, token, config.address, onMessages, onSuggestTitle])

  return (
    <div className="flex flex-col gap-4">
      <AmountField
        label="Amount"
        amount={amount}
        onAmount={setAmount}
        decimals={token?.decimals ?? DECIMALS}
        symbol={asset === NATIVE ? DISPLAY_DENOM : token?.address === SSCRT_ADDRESS ? 'sSCRT' : token?.symbol}
        options={[
          { id: NATIVE, label: DISPLAY_DENOM, detail: 'The native coin — public' },
          ...tokenOptions(allTokens())
        ]}
        optionsLabel="What to send"
        value={asset}
        onSelect={setAsset}
      />

      <Field
        label="To"
        hint={
          asset === NATIVE
            ? 'Public: anyone can see this transfer and its amount.'
            : 'Private: the amount and the recipient are encrypted.'
        }
      >
        <AddressInput value={to} onChange={setTo} />
      </Field>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Wrap and unwrap                                                             */
/* -------------------------------------------------------------------------- */

function WrapForm({
  config,
  onMessages,
  onSuggestTitle,
  unwrapping,
  initial
}: FormProps & { unwrapping: boolean }) {
  const tokens = useMemo(wrappableTokens, [])
  const [contract, setContract] = useState(
    initial?.contract && bankDenomFor(initial.contract) ? initial.contract : SSCRT_ADDRESS
  )
  const [amount, setAmount] = useState('')

  const token = tokenByAddress(contract)
  const name = contract === SSCRT_ADDRESS ? 'sSCRT' : (token?.symbol ?? 'the token')

  useEffect(() => {
    if (!amount || Number(amount) <= 0) return onMessages([])

    onMessages([
      unwrapping
        ? compose.unwrap({ from: config.address, contract, amount })
        : compose.wrap({ from: config.address, contract, amount })
    ])
    onSuggestTitle(unwrapping ? `Unwrap ${amount} ${name}` : `Wrap ${amount} into ${name}`)
  }, [contract, amount, unwrapping, name, config.address, onMessages, onSuggestTitle])

  return (
    <div className="flex flex-col gap-4">
      <AmountField
        label={unwrapping ? 'How much to unwrap' : 'How much to wrap'}
        amount={amount}
        onAmount={setAmount}
        decimals={token?.decimals ?? DECIMALS}
        symbol={unwrapping ? name : DISPLAY_DENOM}
        options={tokenOptions(tokens)}
        optionsLabel="Which token"
        value={contract}
        onSelect={setContract}
      />
      <p className="text-label text-text-faint">
        {unwrapping
          ? `Turns ${name} back into public ${DISPLAY_DENOM}. The balance becomes visible again.`
          : `Turns public ${DISPLAY_DENOM} into ${name}, whose balance only a viewing key can read.`}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Staking                                                                     */
/* -------------------------------------------------------------------------- */

function ClaimForm({ config, onMessages, onSuggestTitle }: FormProps) {
  const { rewards, validators, loading } = useAccountStaking(config.address)
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  // Memoised because the effect below depends on it: a fresh array every
  // render would re-run it forever.
  const earning = useMemo(() => [...rewards.values()].filter((reward) => reward.amount !== '0'), [rewards])

  useEffect(() => {
    const validatorsToClaim = chosen.size > 0 ? [...chosen] : earning.map((reward) => reward.validatorAddress)
    if (validatorsToClaim.length === 0) return onMessages([])

    onMessages(compose.claimRewards({ delegator: config.address, validators: validatorsToClaim }))
    onSuggestTitle(`Claim staking rewards`)
  }, [chosen, earning, config.address, onMessages, onSuggestTitle])

  if (loading) return <p className="text-base text-text-muted">Reading what this account has earned…</p>

  if (earning.length === 0) {
    return (
      <p className="rounded-card border border-border p-4 text-base text-text-muted">
        Nothing to claim: this account has no unclaimed staking rewards.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-base text-text-muted">
        One message per validator — the chain has no single “claim everything”. Leave all of them ticked to
        claim the lot.
      </p>
      <ul className="rounded-card border border-border">
        {earning.map((reward) => {
          const moniker = validators.find((entry) => entry.address === reward.validatorAddress)?.moniker
          const ticked = chosen.size === 0 || chosen.has(reward.validatorAddress)

          return (
            <li key={reward.validatorAddress} className="border-b border-border last:border-b-0">
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={ticked}
                  onChange={() =>
                    setChosen((current) => {
                      // An empty set means "all of them"; the first click has to
                      // materialise that before it can remove one.
                      const next = new Set(
                        current.size === 0 ? earning.map((r) => r.validatorAddress) : current
                      )
                      if (next.has(reward.validatorAddress)) next.delete(reward.validatorAddress)
                      else next.add(reward.validatorAddress)
                      return next
                    })
                  }
                />
                <span className="min-w-0 flex-1 truncate text-base">
                  {moniker ?? reward.validatorAddress}
                </span>
                <span className="shrink-0 font-mono text-sm">
                  {formatAmount(reward.amount, { decimals: DECIMALS, reveal: true })} {DISPLAY_DENOM}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Governance                                                                  */
/* -------------------------------------------------------------------------- */

const VOTE_OPTIONS: PickerOption[] = [
  { id: 'YES', label: 'Yes' },
  { id: 'NO', label: 'No' },
  { id: 'ABSTAIN', label: 'Abstain' },
  { id: 'NO_WITH_VETO', label: 'No with veto' }
]

function VoteForm({ config, onMessages, onSuggestTitle, initial }: FormProps) {
  const [proposalId, setProposalId] = useState(initial?.proposalId ?? '')
  const [option, setOption] = useState(initial?.option ?? 'YES')

  useEffect(() => {
    if (!proposalId.trim()) return onMessages([])
    onMessages([compose.vote({ voter: config.address, proposalId, option })])
    onSuggestTitle(
      `Vote ${VOTE_OPTIONS.find((entry) => entry.id === option)?.label ?? option} on proposal ${proposalId}`
    )
  }, [proposalId, option, config.address, onMessages, onSuggestTitle])

  return (
    <div className="flex flex-col gap-4">
      <Field label="Proposal" hint="The number from the governance screen.">
        <input
          value={proposalId}
          onChange={(event) => setProposalId(event.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          placeholder="370"
          className="w-32 rounded-control border border-border bg-surface px-3 py-2 text-base outline-none focus:border-accent"
        />
      </Field>

      <Field
        label="Vote"
        hint="A multisig’s vote carries the stake it has delegated, like any other account."
      >
        <Picker label="Vote" options={VOTE_OPTIONS} value={option} onChange={setOption} />
      </Field>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Viewing keys and fees                                                       */
/* -------------------------------------------------------------------------- */

function ViewingKeyForm({ config, onMessages, onSuggestTitle }: FormProps) {
  const tokens = useMemo(allTokens, [])
  const [chosen, setChosen] = useState<Set<string>>(new Set([SSCRT_ADDRESS]))
  // Made once per mount: a key that changed on every keystroke would set a
  // different secret at each token in the same proposal.
  const [key] = useState(generateViewingKey)

  useEffect(() => {
    if (chosen.size === 0) return onMessages([])
    onMessages(compose.setViewingKey({ account: config.address, contracts: [...chosen], key }))
    onSuggestTitle(`Set a viewing key on ${chosen.size} token${chosen.size === 1 ? '' : 's'}`)
  }, [chosen, key, config.address, onMessages, onSuggestTitle])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-text-muted">
        One key, stored at each token you pick. Every member gets it by decrypting this proposal, so nothing
        has to be sent separately — and because it is a shared secret, removing a member means setting a new
        one.
      </p>

      <ul className="max-h-[320px] overflow-y-auto rounded-card border border-border">
        {tokens.map((token) => (
          <li key={token.address} className="border-b border-border last:border-b-0">
            <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
              <input
                type="checkbox"
                checked={chosen.has(token.address)}
                onChange={() =>
                  setChosen((current) => {
                    const next = new Set(current)
                    if (next.has(token.address)) next.delete(token.address)
                    else next.add(token.address)
                    return next
                  })
                }
              />
              <img src={tokenImageUrl(token)} alt="" className="size-5 shrink-0 rounded-pill" />
              <span className="truncate text-base">
                {token.address === SSCRT_ADDRESS ? 'sSCRT' : token.symbol}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <p className="text-label text-text-faint">
        Each token costs its own message and its own gas, so pick the ones the group actually holds.
      </p>
    </div>
  )
}

function FeeGrantForm({ config, onMessages, onSuggestTitle, revoking }: FormProps & { revoking: boolean }) {
  const [grantee, setGrantee] = useState('')
  const [limit, setLimit] = useState('')

  useEffect(() => {
    if (!isValidBech32(grantee.trim(), BECH32_PREFIX)) return onMessages([])

    onMessages([
      revoking
        ? compose.revokeFeeAllowance({ granter: config.address, grantee })
        : compose.grantFeeAllowance({ granter: config.address, grantee, limit: limit || undefined })
    ])
    onSuggestTitle(revoking ? 'Stop paying an account’s fees' : 'Pay an account’s fees')
  }, [grantee, limit, revoking, config.address, onMessages, onSuggestTitle])

  return (
    <div className="flex flex-col gap-4">
      <Field
        label={revoking ? 'Whose allowance to cancel' : 'Who this account will pay for'}
        hint={
          revoking
            ? 'They keep any SCRT they hold; only the allowance goes.'
            : 'They can then send transactions without holding any SCRT of their own.'
        }
      >
        <AddressInput value={grantee} onChange={setGrantee} />
      </Field>

      {!revoking ? (
        <Field
          label={`Limit in ${DISPLAY_DENOM} (optional)`}
          hint={
            limit
              ? 'Once spent, the allowance is exhausted and has to be granted again.'
              : 'Left empty, the allowance is unlimited until it is revoked — they could spend this account’s whole balance on fees.'
          }
        >
          <input
            value={limit}
            onChange={(event) => setLimit(event.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            placeholder="1"
            className="w-32 rounded-control border border-border bg-surface px-3 py-2 text-base outline-none focus:border-accent"
          />
        </Field>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export default function ProposalForm({ kind, ...props }: FormProps & { kind: ActionKind }) {
  switch (kind) {
    case 'send':
      return <SendForm {...props} />
    case 'wrap':
      return <WrapForm {...props} unwrapping={false} />
    case 'unwrap':
      return <WrapForm {...props} unwrapping />
    // The staking screen's own dialog, not a form — see `StakeProposal`.
    case 'stake':
    case 'unstake':
    case 'redelegate':
      return <StakeProposal {...props} kind={kind} />
    case 'claim':
      return <ClaimForm {...props} />
    case 'vote':
      return <VoteForm {...props} />
    case 'viewing-key':
      return <ViewingKeyForm {...props} />
    case 'fee-grant':
      return <FeeGrantForm {...props} revoking={false} />
    case 'fee-revoke':
      return <FeeGrantForm {...props} revoking />
  }
}
