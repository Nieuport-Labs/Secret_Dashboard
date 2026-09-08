import type { SecretNetworkClient } from 'secretjs'

import { DENOM } from '@/chains/secret4'
import { parseTimestamp } from '@/lib/feegrant-sdk'

/**
 * On-chain governance: proposals, tallies, and voting.
 *
 * Read over `x/gov` **v1**, not v1beta1. Both are served on secret-4, and v1 is
 * the one worth having: it carries `title`, `summary`, `proposer` and
 * `expedited` as first-class fields, and back-fills the first two from the
 * legacy `content` of older proposals, so one shape covers the whole history
 * rather than two code paths. secretjs agrees — `client.query.gov` is the v1
 * querier and `MsgVote` carries the `/cosmos.gov.v1.` type URL.
 *
 * Verified against secret-4 while writing this; see the notes on each query.
 */

export type ProposalStatus =
  | 'PROPOSAL_STATUS_UNSPECIFIED'
  | 'PROPOSAL_STATUS_DEPOSIT_PERIOD'
  | 'PROPOSAL_STATUS_VOTING_PERIOD'
  | 'PROPOSAL_STATUS_PASSED'
  | 'PROPOSAL_STATUS_REJECTED'
  | 'PROPOSAL_STATUS_FAILED'

/** The four ways to vote, in the chain's own spelling minus the prefix. */
export type VoteOption = 'YES' | 'ABSTAIN' | 'NO' | 'NO_WITH_VETO'

/** Voting power behind each option, in base units. */
export interface Tally {
  yes: bigint
  abstain: bigint
  no: bigint
  veto: bigint
}

export interface Proposal {
  id: string
  title: string
  /** The proposer's own prose. Untrusted — see `Governance.tsx` on rendering. */
  summary: string
  status: ProposalStatus
  /** Type URLs of what this proposal would execute if it passed. */
  messageTypes: string[]
  /**
   * The messages themselves, as the chain returned them.
   *
   * Kept raw and untyped on purpose: there are dozens of proposal message
   * types across Cosmos and Secret's own modules, and the detail page shows
   * whatever fields a given one happens to carry rather than knowing about
   * each in advance.
   */
  messages: Array<Record<string, unknown>>
  submitTime?: Date
  depositEndTime?: Date
  votingStartTime?: Date
  votingEndTime?: Date
  /** Base units of SCRT put up so far. */
  totalDeposit: string
  proposer?: string
  /**
   * Secret's expedited track: a shorter voting period and a higher bar to pass.
   * Both differ from the ordinary ones, so this is not cosmetic.
   */
  expedited: boolean
  /**
   * Only meaningful once voting has closed. During the voting period the chain
   * leaves this at zero and the live figures come from `queryTally`.
   */
  finalTally: Tally
}

export interface GovParams {
  /** Fraction of bonded stake that must vote at all for the result to count. */
  quorum: number
  /** Fraction of yes/no/veto that must be yes. */
  threshold: number
  /** Veto share that rejects the proposal outright, quorum or not. */
  vetoThreshold: number
  /** The higher bar an expedited proposal has to clear instead of `threshold`. */
  expeditedThreshold: number
  /** Base units of SCRT a proposal needs before it reaches a vote. */
  minDeposit: string
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

function toTally(raw: Record<string, string | undefined> | undefined): Tally {
  const at = (key: string) => BigInt(raw?.[key] ?? '0')
  return {
    yes: at('yes_count'),
    abstain: at('abstain_count'),
    no: at('no_count'),
    veto: at('no_with_veto_count')
  }
}

function toProposal(raw: {
  id?: string
  title?: string
  summary?: string
  status?: string
  messages?: Array<Record<string, unknown>>
  final_tally_result?: Record<string, string | undefined>
  submit_time?: unknown
  deposit_end_time?: unknown
  voting_start_time?: unknown
  voting_end_time?: unknown
  total_deposit?: Array<{ denom?: string; amount?: string }>
  proposer?: string
  expedited?: boolean
}): Proposal {
  return {
    id: raw.id ?? '',
    // A proposal with neither is possible in principle and unreadable in
    // practice, so it gets its number rather than an empty row.
    title: raw.title?.trim() || `Proposal ${raw.id ?? '?'}`,
    summary: raw.summary?.trim() ?? '',
    status: (raw.status as ProposalStatus) ?? 'PROPOSAL_STATUS_UNSPECIFIED',
    messageTypes: (raw.messages ?? []).map((m) => String(m['@type'] ?? '')).filter(Boolean),
    messages: raw.messages ?? [],
    submitTime: parseTimestamp(raw.submit_time),
    depositEndTime: parseTimestamp(raw.deposit_end_time),
    votingStartTime: parseTimestamp(raw.voting_start_time),
    votingEndTime: parseTimestamp(raw.voting_end_time),
    // Deposits can in principle be in any denom; only SCRT counts toward the
    // minimum, so summing the rest would overstate how close it is.
    totalDeposit: (raw.total_deposit ?? [])
      .filter((c) => c.denom === DENOM)
      .reduce((sum, c) => sum + BigInt(c.amount ?? '0'), 0n)
      .toString(),
    proposer: raw.proposer || undefined,
    expedited: Boolean(raw.expedited),
    finalTally: toTally(raw.final_tally_result)
  }
}

/**
 * Every proposal the chain has, newest first.
 *
 * All of them in one request rather than paged. secret-4's whole governance
 * history is 290 proposals and about 800 KB uncompressed — one request, near
 * enough a second, and gzipped over the wire by any browser. Paging would save
 * little and cost the thing that matters most on this page: searching and
 * filtering across the entire history instead of across whichever page happens
 * to be loaded, which is a search that quietly lies about what it did not find.
 *
 * Reverse order is the chain's own, not a client-side sort.
 */
export async function queryAllProposals(client: SecretNetworkClient): Promise<Proposal[]> {
  const response = await client.query.gov.proposals({
    pagination: { limit: '500', reverse: true }
  })

  return (response.proposals ?? []).map(toProposal).filter((p) => p.id)
}

export async function queryProposal(
  client: SecretNetworkClient,
  id: string
): Promise<Proposal | undefined> {
  const response = await client.query.gov.proposal({ proposal_id: id })
  return response.proposal ? toProposal(response.proposal) : undefined
}

/**
 * The running count, which is a different question from `final_tally_result`.
 *
 * While a proposal is open the chain leaves the stored tally at zero and
 * computes the real one on demand — so a screen that reads only the proposal
 * shows every live vote as 0/0/0/0.
 */
export async function queryTally(client: SecretNetworkClient, id: string): Promise<Tally> {
  const response = await client.query.gov.tallyResult({ proposal_id: id })
  return toTally(response.tally)
}

/**
 * How this account voted, if it has.
 *
 * The chain answers "no vote" with an HTTP 400, which secretjs raises, so the
 * absence of a vote arrives here as a thrown error rather than an empty result.
 * Votes are also pruned once a proposal is tallied, so this is only ever asked
 * of one that is still open.
 */
export async function queryMyVote(
  client: SecretNetworkClient,
  id: string,
  voter: string
): Promise<VoteOption | undefined> {
  try {
    const response = await client.query.gov.vote({ proposal_id: id, voter })
    const option = response.vote?.options?.[0]?.option
    return option ? (String(option).replace('VOTE_OPTION_', '') as VoteOption) : undefined
  } catch {
    return undefined
  }
}

/**
 * Quorum, thresholds and the deposit floor.
 *
 * One request: `params_type` is a legacy selector that splits the answer into
 * `voting_params` / `deposit_params` / `tally_params`, but the node fills the
 * unified `params` object regardless of which is asked for.
 */
export async function queryGovParams(client: SecretNetworkClient): Promise<GovParams> {
  const response = await client.query.gov.params({ params_type: 'tallying' })
  const params = response.params

  const asFraction = (value: string | undefined, fallback: number) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  return {
    quorum: asFraction(params?.quorum, 0.334),
    threshold: asFraction(params?.threshold, 0.5),
    vetoThreshold: asFraction(params?.veto_threshold, 0.334),
    // Falls back to the ordinary threshold rather than to a guess: treating a
    // proposal as needing a bar the chain never stated would misreport it.
    expeditedThreshold: asFraction(params?.expedited_threshold, asFraction(params?.threshold, 0.5)),
    minDeposit:
      (params?.min_deposit ?? []).find((c) => c.denom === DENOM)?.amount ?? '0'
  }
}

/** Everything currently staked — the denominator quorum is measured against. */
export async function queryBondedTokens(client: SecretNetworkClient): Promise<bigint> {
  const response = await client.query.staking.pool({})
  return BigInt(response.pool?.bonded_tokens ?? '0')
}

/* -------------------------------------------------------------------------- */
/* Reading a tally                                                             */
/* -------------------------------------------------------------------------- */

export interface Outcome {
  /** Voting power cast, in base units. */
  voted: bigint
  /** Cast as a fraction of everything bonded. */
  turnout: number
  /** The turnout quorum in force, carried alongside so a bar can show both. */
  quorum: number
  quorumMet: boolean
  /** Yes as a fraction of yes + no + veto. Abstain deliberately excluded — it
   *  counts toward quorum and against nothing. */
  yesRatio: number
  /** Veto as a fraction of everything cast, abstain included. */
  vetoRatio: number
  vetoed: boolean
  /** The yes bar that applies to this proposal, expedited or not. */
  threshold: number
  /** Whether it would pass if the vote closed now. */
  passing: boolean
}

/**
 * What a tally means, by the chain's own three tests.
 *
 * Turnout has to clear quorum, veto has to stay under its own threshold, and
 * yes has to beat the threshold among the votes that took a side. All three, in
 * that order — a proposal with 90% yes and 10% turnout fails, and so does one
 * vetoed by a third of the voters however many said yes.
 *
 * `undefined` when nothing is bonded, which cannot happen on a live chain but
 * would otherwise divide by zero and report a confident nonsense.
 */
export function evaluate(
  tally: Tally,
  bondedTokens: bigint,
  params: GovParams,
  expedited: boolean
): Outcome | undefined {
  if (bondedTokens <= 0n) return undefined

  const voted = tally.yes + tally.abstain + tally.no + tally.veto
  const decisive = tally.yes + tally.no + tally.veto

  // Ratios of 15-digit token counts, taken in BigInt and only then divided —
  // never by turning either side into a float first.
  const ratio = (part: bigint, whole: bigint) =>
    whole <= 0n ? 0 : Number((part * 1_000_000n) / whole) / 1_000_000

  const turnout = ratio(voted, bondedTokens)
  const yesRatio = ratio(tally.yes, decisive)
  const vetoRatio = ratio(tally.veto, voted)
  const threshold = expedited ? params.expeditedThreshold : params.threshold

  const quorumMet = turnout >= params.quorum
  const vetoed = vetoRatio >= params.vetoThreshold

  return {
    voted,
    turnout,
    quorum: params.quorum,
    quorumMet,
    yesRatio,
    vetoRatio,
    vetoed,
    threshold,
    passing: quorumMet && !vetoed && decisive > 0n && yesRatio > threshold
  }
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

export const VOTE_LABELS: Record<VoteOption, string> = {
  YES: 'Yes',
  ABSTAIN: 'Abstain',
  NO: 'No',
  NO_WITH_VETO: 'No with veto'
}

export const STATUS_LABELS: Record<ProposalStatus, string> = {
  PROPOSAL_STATUS_UNSPECIFIED: 'Unknown',
  PROPOSAL_STATUS_DEPOSIT_PERIOD: 'Deposit',
  PROPOSAL_STATUS_VOTING_PERIOD: 'Voting',
  PROPOSAL_STATUS_PASSED: 'Passed',
  PROPOSAL_STATUS_REJECTED: 'Rejected',
  PROPOSAL_STATUS_FAILED: 'Failed'
}

/**
 * "Expires in 20h", for a proposal with a deadline still ahead of it.
 *
 * `undefined` once a proposal is decided — a closed one has an end date, not
 * time remaining, and counting down to a moment in the past reads as a bug.
 */
export function timeRemaining(proposal: Proposal): string | undefined {
  const deadline =
    proposal.status === 'PROPOSAL_STATUS_VOTING_PERIOD'
      ? proposal.votingEndTime
      : proposal.status === 'PROPOSAL_STATUS_DEPOSIT_PERIOD'
        ? proposal.depositEndTime
        : undefined

  if (!deadline) return undefined

  const ms = deadline.getTime() - Date.now()
  // Past its deadline but not yet tallied — the chain closes it on the next
  // block, so neither "expired" nor a countdown is true.
  if (ms <= 0) return 'Closing'

  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `Expires in ${Math.max(1, minutes)}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `Expires in ${hours}h`

  return `Expires in ${Math.floor(hours / 24)}d ${hours % 24}h`
}

/**
 * `/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade` → `Software upgrade`.
 *
 * What a proposal would actually execute is the most useful thing about it that
 * the proposer did not write themselves, so it is worth showing — but the raw
 * type URL is noise in a list.
 */
export function messageTypeLabel(typeUrl: string): string {
  const name = typeUrl.split('.').pop() ?? typeUrl
  const words = name
    .replace(/^Msg/, '')
    // Trailing `Proposal` is redundant on a page that is entirely proposals.
    .replace(/Proposal$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (!words) return 'Text'
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Built here rather than in a component, so no screen can send a vote without
 * the fee-payer treatment every transaction in this app gets.
 *
 * Note the two `VoteOption`s in secretjs that share a name: the query layer's
 * is the string enum the chain answers with, and this one — the protobuf enum
 * the message carries — is numeric. Handing the string to `MsgVote` produces a
 * transaction the chain rejects.
 */
export async function voteMessage(proposalId: string, voter: string, option: VoteOption) {
  const { MsgVote, VoteOption: Options } = await import('secretjs')
  const numeric: Record<VoteOption, number> = {
    YES: Options.VOTE_OPTION_YES,
    ABSTAIN: Options.VOTE_OPTION_ABSTAIN,
    NO: Options.VOTE_OPTION_NO,
    NO_WITH_VETO: Options.VOTE_OPTION_NO_WITH_VETO
  }

  return new MsgVote({
    proposal_id: proposalId,
    voter,
    option: numeric[option],
    // Required by the message type. The chain stores it verbatim and this app
    // has nothing to put in it.
    metadata: ''
  })
}
