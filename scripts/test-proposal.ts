/**
 * Tests for submitting a governance proposal.
 *
 * Two halves. The first is offline and checks the thing that cannot be checked
 * by eye: hand-written JSON turned into protobuf keeps its meaning, and the
 * failures are refused rather than silently mangled. Protobuf has no notion of
 * an unexpected field, so a misspelled key is dropped without a word — which on
 * a proposal means one that reads right and executes something else.
 *
 * The second half asks secret-4 itself: the deposit rules the form quotes are
 * read back from the chain, and a complete `MsgSubmitProposal` is simulated
 * against a node — the same rehearsal the page offers — so the encoding path is
 * known to produce a transaction the chain accepts, rather than assumed to.
 *
 * Nothing here signs or broadcasts anything.
 *
 *   npm run test:proposal
 */

import { encodeProposalMessages, GOV_AUTHORITY } from '../src/lib/proposalMessages.ts'
import { minimumInitialDeposit, queryGovParams, submitProposalMessage } from '../src/lib/governance.ts'
import { DEFAULT_LCD_URLS, CHAIN_ID, DENOM } from '../src/chains/secret4.ts'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1
    return
  }
  failed += 1
  console.log(`FAIL  ${name}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

async function refuses(name: string, json: string, expected: RegExp): Promise<void> {
  try {
    await encodeProposalMessages(json)
    check(name, false, 'it was accepted')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(name, expected.test(message), message)
  }
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                    */
/* -------------------------------------------------------------------------- */

const SPEND = {
  '@type': '/cosmos.distribution.v1beta1.MsgCommunityPoolSpend',
  authority: GOV_AUTHORITY,
  recipient: 'secret1kkmu4vydkppkhzmx00glm20vn47t09544adv0g',
  amount: [{ denom: DENOM, amount: '1000000' }]
}

const empty = await encodeProposalMessages('   ')
check('nothing written is a text proposal, not an error', empty.length === 0)

const single = await encodeProposalMessages(JSON.stringify(SPEND))
check('a bare object is accepted, not only an array', single.length === 1)
check(
  'the round trip keeps every field',
  JSON.stringify(single[0]?.decoded) ===
    JSON.stringify({
      authority: SPEND.authority,
      recipient: SPEND.recipient,
      amount: SPEND.amount
    }),
  single[0]?.decoded
)

const pair = await encodeProposalMessages(JSON.stringify([SPEND, SPEND]))
check('an array of messages keeps its order and length', pair.length === 2)

const protoMsg = await pair[0]!.msg.toProto()
check('the encoded message carries its own type URL', protoMsg.type_url === SPEND['@type'])
check('and encodes to bytes', protoMsg.encode().length > 0)

/* An upgrade plan: nested object, an int64 height, and a timestamp. */
const upgrade = await encodeProposalMessages(
  JSON.stringify({
    '@type': '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade',
    authority: GOV_AUTHORITY,
    plan: { name: 'v1.19', height: '18000000', info: '' }
  })
)
check(
  'a nested plan survives the round trip',
  (upgrade[0]?.decoded.plan as { name?: string; height?: string } | undefined)?.name === 'v1.19' &&
    String((upgrade[0]?.decoded.plan as { height?: string }).height) === '18000000',
  upgrade[0]?.decoded
)

/*
 * The whole reason the page shows the round trip back to the author. This is
 * not caught as an error anywhere — protobuf simply has nowhere to put it —
 * so the only defence is that what was understood is visible before signing.
 */
const typo = await encodeProposalMessages(
  JSON.stringify({ ...SPEND, recipent: 'secret1typo', recipient: undefined })
)
check(
  'a misspelled field is dropped rather than carried',
  !('recipent' in (typo[0]?.decoded ?? {})) && !(typo[0]?.decoded ?? {}).recipient,
  typo[0]?.decoded
)

await refuses('bad JSON says so', '{ not json', /valid JSON/)
await refuses('a message with no type is refused', '{"authority":"x"}', /needs an "@type"/)
await refuses(
  'an unknown type is refused rather than guessed at',
  '{"@type":"/cosmos.bank.v1beta1.MsgNope"}',
  /Unknown message type/
)
await refuses(
  'a contract message is refused, because its payload must be encrypted',
  '{"@type":"/secret.compute.v1beta1.MsgExecuteContract","sender":"x"}',
  /encrypted payload/
)
await refuses('a bare string is not a message', '"hello"', /must be a JSON object/)

/* -------------------------------------------------------------------------- */
/* Governance parameters                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The message secretjs's own registry does not list, and the durations it
 * mangles.
 *
 * Both gaps are silent by nature — an unregistered type reads as "unknown
 * message type" and a mangled duration as nothing at all — so both are pinned
 * here. The figures are the live ones with the two deposits raised, which is
 * what a parameter change actually looks like.
 */
const UPDATE_PARAMS = {
  '@type': '/cosmos.gov.v1.MsgUpdateParams',
  authority: GOV_AUTHORITY,
  params: {
    min_deposit: [{ denom: DENOM, amount: '5000000000' }],
    max_deposit_period: '604800s',
    voting_period: '604800s',
    quorum: '0.334000000000000000',
    threshold: '0.500000000000000000',
    veto_threshold: '0.334000000000000000',
    min_initial_deposit_ratio: '0.000000000000000000',
    proposal_cancel_ratio: '0.500000000000000000',
    proposal_cancel_dest: '',
    expedited_voting_period: '86400s',
    expedited_threshold: '0.666666666666666667',
    expedited_min_deposit: [{ denom: DENOM, amount: '12500000000' }],
    burn_vote_quorum: false,
    burn_proposal_deposit_prevote: false,
    burn_vote_veto: true,
    min_deposit_ratio: '0.010000000000000000'
  }
}

const updateParams = await encodeProposalMessages(JSON.stringify(UPDATE_PARAMS))
const written = (updateParams[0]?.decoded.params ?? {}) as Record<string, unknown>
const seconds = (field: string) => String((written[field] as { seconds?: string })?.seconds ?? '')

check('MsgUpdateParams encodes at all', updateParams.length === 1)
check(
  'the voting period survives as seven days, not as zero',
  seconds('voting_period') === '604800',
  written.voting_period
)
check('the deposit period survives', seconds('max_deposit_period') === '604800', written.max_deposit_period)
check(
  'so does the expedited one, at a day',
  seconds('expedited_voting_period') === '86400',
  written.expedited_voting_period
)
check(
  'the raised deposits are carried verbatim',
  JSON.stringify(written.min_deposit) === JSON.stringify(UPDATE_PARAMS.params.min_deposit) &&
    JSON.stringify(written.expedited_min_deposit) ===
      JSON.stringify(UPDATE_PARAMS.params.expedited_min_deposit),
  [written.min_deposit, written.expedited_min_deposit]
)
/*
 * An empty `proposal_cancel_dest` means "burn it", and proto3 writes a default
 * as nothing at all — so it is absent from the round trip rather than blank.
 * What matters is that nothing put an address there.
 */
check(
  'an empty cancel destination stays empty rather than acquiring an address',
  !written.proposal_cancel_dest,
  written.proposal_cancel_dest
)
check(
  'a false flag stays false and a true one stays true',
  written.burn_vote_veto === true && !written.burn_vote_quorum,
  [written.burn_vote_veto, written.burn_vote_quorum]
)

/* A duration-shaped string in a field that is really a string must survive as
   one, which is what the fallback in `encodeProposalMessages` is for. */
const memo = await encodeProposalMessages(
  JSON.stringify({
    '@type': '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade',
    authority: GOV_AUTHORITY,
    plan: { name: '600s', height: '1', info: '' }
  })
)
check(
  'a string that merely looks like a duration is left alone',
  (memo[0]?.decoded.plan as { name?: string } | undefined)?.name === '600s',
  memo[0]?.decoded
)

/* -------------------------------------------------------------------------- */
/* The chain                                                                   */
/* -------------------------------------------------------------------------- */

const { SecretNetworkClient } = await import('secretjs')

const url = process.env.LCD_URL ?? DEFAULT_LCD_URLS[0]!
const query = new SecretNetworkClient({ url, chainId: CHAIN_ID })

const params = await queryGovParams(query)
console.log(
  `\n${url}\n  min deposit          ${params.minDeposit} ${DENOM}` +
    `\n  expedited            ${params.expeditedMinDeposit} ${DENOM}` +
    `\n  min deposit ratio    ${params.minDepositRatio}` +
    `\n  smallest submission  ${minimumInitialDeposit(params, false)} ${DENOM}` +
    ` (expedited ${minimumInitialDeposit(params, true)})\n`
)

check('the chain states a minimum deposit', BigInt(params.minDeposit) > 0n)
check(
  'the expedited floor is the higher of the two',
  BigInt(params.expeditedMinDeposit) >= BigInt(params.minDeposit)
)
check('voting periods are known', params.votingPeriod > 0 && params.expeditedVotingPeriod > 0)
check(
  'the smallest single deposit is the ratio of the minimum',
  minimumInitialDeposit(params, false) ===
    BigInt(Math.round(Number(params.minDeposit) * params.minDepositRatio))
)

/*
 * Simulation, which is what the page's Rehearse button does through secretjs.
 *
 * Assembled by hand here rather than through `client.tx.simulate`, for one
 * reason: that path needs a signer holding the proposer's key, and this script
 * has no key and wants none. A simulation's signature is never verified, so an
 * account is borrowed from the chain's own history — its address, number,
 * sequence and public key, all of it public — and a transaction is built around
 * exactly the `MsgSubmitProposal` bytes the app would send. Nothing is signed
 * and nothing is broadcast; only the encoding is on trial.
 */
const { TxBody, TxRaw } = await import('cosmjs-types/cosmos/tx/v1beta1/tx.js')
const { makeAuthInfoBytes } = await import('@cosmjs/proto-signing')
const { fromBase64, toBase64 } = await import('@cosmjs/encoding')

const recent = await query.query.gov.proposals({ pagination: { limit: '1', reverse: true } })
const borrowed = recent.proposals?.[0]?.proposer
const account = borrowed ? (await query.query.auth.account({ address: borrowed })).account : undefined
const base = account as
  { account_number?: string; sequence?: string; pub_key?: { '@type'?: string; key?: string } } | undefined

if (!borrowed || !base?.pub_key?.key) {
  check('an account to simulate against', false, 'no recent proposer with a public key on chain')
} else {
  const message = await submitProposalMessage(
    {
      title: 'Simulated, never submitted',
      summary: 'Written by scripts/test-proposal.ts to check that the encoding is accepted.',
      metadata: '',
      /*
       * The parameter change, because it is the message this whole path exists
       * for: unregistered in secretjs and full of durations.
       *
       * What this proves is narrower than it looks, and the difference matters.
       * A node was asked the same question with the durations deliberately
       * mangled and accepted that too: gov does not validate a proposal's
       * messages when it stores them, only when it executes them after the
       * vote. So the simulation says the transaction is well-formed and the
       * chain will take the proposal — the assertions above, made against the
       * bytes themselves, are what say it carries what was written.
       */
      messages: updateParams.map((m) => m.msg),
      initialDeposit: minimumInitialDeposit(params, false).toString(),
      expedited: false
    },
    borrowed
  )
  const proto = await message.toProto()

  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: [{ typeUrl: proto.type_url, value: proto.encode() }],
      memo: ''
    })
  ).finish()

  const authInfoBytes = makeAuthInfoBytes(
    [
      {
        pubkey: {
          typeUrl: '/cosmos.crypto.secp256k1.PubKey',
          // The `Any` for a secp256k1 key: field 1, length-prefixed bytes.
          value: new Uint8Array([10, 33, ...fromBase64(base.pub_key.key)])
        },
        sequence: Number(base.sequence ?? 0)
      }
    ],
    [{ denom: DENOM, amount: '40000' }],
    400_000,
    undefined,
    undefined
  )

  const txBytes = TxRaw.encode(
    TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [new Uint8Array(64)] })
  ).finish()

  const response = await fetch(`${url}/cosmos/tx/v1beta1/simulate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx_bytes: toBase64(txBytes) })
  })
  const result = (await response.json()) as {
    gas_info?: { gas_used?: string }
    message?: string
  }
  const used = Number(result.gas_info?.gas_used ?? 0)

  check('the chain accepts a proposal carrying it', used > 0, result.message ?? result)
  if (used > 0) {
    console.log(`  simulated submission ${used} gas\n`)
    check('and the app’s 400k gas limit covers it', used < 400_000, used)
  }
}

console.log(`${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
