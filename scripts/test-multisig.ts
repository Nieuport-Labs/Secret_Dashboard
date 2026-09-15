/**
 * Tests for multisig accounts.
 *
 * The thing this file exists to prove is the one that cannot be checked by
 * eye and cannot be undone: that the address derived from a set of public keys
 * and a threshold is the same address `secretcli` derives from the same
 * inputs. Coins sent to a wrong multisig address are not recoverable by
 * anyone, so "we believe cosmjs and the SDK agree" is not good enough — the
 * vectors below were produced by `secretcli 1.25.0` and are re-checked on
 * every run.
 *
 * The second half checks the document members sign: that the fee granter is
 * inside the signed bytes (it is, which is why the transaction assembler
 * cannot use `@cosmjs/stargate`'s multisig helper), and that the awkward
 * corners of amino serialisation — sorted keys, escaped `&`, `<`, `>` — behave
 * as the chain expects.
 *
 * Nothing here signs with a real key, touches a wallet, or broadcasts.
 *
 *   npm run test:multisig
 *
 * ## Regenerating the vectors
 *
 * ```
 * secretcli keys add ms_a --keyring-backend test --keyring-dir <dir> --output json
 * secretcli keys add ms_b …    # and ms_c
 * secretcli keys add ms_2of3 --multisig ms_a,ms_b,ms_c --multisig-threshold 2 \
 *   --keyring-backend test --keyring-dir <dir> --output json
 * ```
 *
 * The keys are throwaway and hold nothing; only their public halves are here.
 */

import { fromBase64, toBase64 } from '@cosmjs/encoding'
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx.js'
import { AuthInfo, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js'

import { assembleTx, buildBodyBytes, compactBitArray } from '../src/lib/multisig/assemble.ts'
import {
  addressForPubkey,
  createConfig,
  deriveMultisig,
  fingerprint,
  parseConfig,
  thresholdPubkeyFor,
  validateConfig,
  type MultisigConfig
} from '../src/lib/multisig/config.ts'
import {
  buildSignDoc,
  docsEqual,
  signBytes,
  signBytesHash,
  type SignDocInput
} from '../src/lib/multisig/signdoc.ts'

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

function refuses(name: string, run: () => unknown, expected: RegExp): void {
  try {
    run()
    check(name, false, 'it was accepted')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(name, expected.test(message), message)
  }
}

/* -------------------------------------------------------------------------- */
/* Vectors — secretcli 1.25.0                                                  */
/* -------------------------------------------------------------------------- */

const KEY_A = 'AmfNHeJ7T7csob3BIEWdvJ7rb/LjgFSRB6Fj2aDxO13Z'
const KEY_B = 'At7MhYj0ZvrKKX3ZiRFQwr9KwOzswaBb2susl6aLC7LX'
const KEY_C = 'A8l545foU0sETx9ZpL73kbMJlbwCWKJ0vP8+Rf5HjgxN'

const ADDRESS_A = 'secret1vgyaeqgmvln7755u7ly4r2dy3ljv93waw5es5n'
const ADDRESS_B = 'secret17nyn59zpqel3f00h9lt8ahd55kx55fz7xff5n2'
const ADDRESS_C = 'secret16e5l94gpa27zthmzydrtgvddypvmf5nrjny6ss'

/** `secretcli keys add ms_2of3 --multisig ms_a,ms_b,ms_c --multisig-threshold 2`. */
const MULTISIG_2OF3 = 'secret17jmusgw3dktk0uajhpezadjvxrdzwdf2u099ud'
/** The order the SDK sorted them into — by raw address, not by input order. */
const SORTED = [KEY_A, KEY_C, KEY_B]

function sampleConfig(): MultisigConfig {
  return createConfig({
    label: 'Treasury',
    threshold: 2,
    members: [{ pubkey: KEY_A }, { pubkey: KEY_B }, { pubkey: KEY_C }],
    roomKey: 'f'.repeat(64)
  })
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

function testDerivation(): void {
  check('member address A matches secretcli', addressForPubkey(KEY_A) === ADDRESS_A, addressForPubkey(KEY_A))
  check('member address B matches secretcli', addressForPubkey(KEY_B) === ADDRESS_B, addressForPubkey(KEY_B))
  check('member address C matches secretcli', addressForPubkey(KEY_C) === ADDRESS_C, addressForPubkey(KEY_C))

  const derived = deriveMultisig([KEY_A, KEY_B, KEY_C], 2)
  check('2-of-3 address matches secretcli', derived.address === MULTISIG_2OF3, derived.address)
  check('members are sorted the way the SDK sorts them', derived.order.join() === SORTED.join(), derived.order)

  // The sort is what makes this true, and it is the difference between a group
  // agreeing on one account and each member creating a different one.
  const shuffled = deriveMultisig([KEY_C, KEY_B, KEY_A], 2)
  check('input order does not change the address', shuffled.address === MULTISIG_2OF3, shuffled.address)

  const threeOfThree = deriveMultisig([KEY_A, KEY_B, KEY_C], 3)
  check('the threshold is part of the address', threeOfThree.address !== MULTISIG_2OF3, threeOfThree.address)

  const twoOfTwo = deriveMultisig([KEY_A, KEY_B], 2)
  check('dropping a member changes the address', twoOfTwo.address !== MULTISIG_2OF3, twoOfTwo.address)

  refuses('a threshold above the member count is refused', () => deriveMultisig([KEY_A, KEY_B], 3), /cannot be met/)
  refuses('a threshold of zero is refused', () => deriveMultisig([KEY_A], 0), /at least 1/)
  refuses('an uncompressed key is refused', () => addressForPubkey('BBBB'), /compressed secp256k1/)
  refuses('a non-base64 key is refused', () => addressForPubkey('not a key!!'), /base64|compressed/)
  refuses(
    'an ed25519-length key is refused',
    () => addressForPubkey(Buffer.alloc(32, 1).toString('base64')),
    /compressed secp256k1/
  )
}

/* -------------------------------------------------------------------------- */
/* Fingerprint                                                                 */
/* -------------------------------------------------------------------------- */

function testFingerprint(): void {
  const one = fingerprint(2, SORTED)
  const again = fingerprint(2, SORTED)
  check('fingerprint is stable', one === again, one)
  check('fingerprint is readable', /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/.test(one), one)
  check('the threshold is in the fingerprint', fingerprint(3, SORTED) !== one)
  check('the member set is in the fingerprint', fingerprint(2, [KEY_A, KEY_B]) !== one)
  check('member order is in the fingerprint', fingerprint(2, [KEY_C, KEY_A, KEY_B]) !== one)
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

function testConfig(): void {
  const config = sampleConfig()
  check('a created config carries the derived address', config.address === MULTISIG_2OF3, config.address)
  check('a created config stores members in derivation order', config.members.map((m) => m.pubkey).join() === SORTED.join())
  check('member addresses are derived, not taken on trust', config.members[0].address === ADDRESS_A)
  check('a sound config has nothing to report', validateConfig(config).length === 0, validateConfig(config))

  const roundTripped = parseConfig(JSON.stringify(config))
  check('a config survives export and import', roundTripped.address === config.address)

  // The check that matters most: a config may not claim an address its own
  // keys do not produce. Anything else lets an import redirect a "top up the
  // multisig" instruction to somebody else's account.
  const lying = { ...config, address: ADDRESS_A }
  refuses('a config claiming the wrong address is refused', () => parseConfig(JSON.stringify(lying)), /Do not use it/)

  const reordered = { ...config, members: [...config.members].reverse() }
  refuses('a config with reordered members is refused', () => parseConfig(JSON.stringify(reordered)), /Do not use it|order/)

  const swappedKey = {
    ...config,
    members: config.members.map((member, index) => (index === 0 ? { ...member, pubkey: KEY_B } : member))
  }
  refuses('a member whose key and address disagree is refused', () => parseConfig(JSON.stringify(swappedKey)), /actually belongs to/)

  refuses('an unknown field is refused', () => parseConfig(JSON.stringify({ ...config, extra: 1 })), /Unexpected field/)
  refuses('another version is refused', () => parseConfig(JSON.stringify({ ...config, version: 2 })), /different version/)
  refuses('another chain is refused', () => parseConfig(JSON.stringify({ ...config, chainId: 'pulsar-3' })), /not secret-4/)
  refuses('a malformed transport key is refused', () => parseConfig(JSON.stringify({ ...config, roomKey: 'nope' })), /transport key/)
  refuses('an empty member list is refused', () => parseConfig(JSON.stringify({ ...config, members: [] })), /member list/)
  refuses('a non-object is refused', () => parseConfig('[]'), /JSON object/)
  refuses('broken JSON is refused', () => parseConfig('{'), /valid JSON/)
  refuses('an oversized document is refused', () => parseConfig(`{"padding":"${'x'.repeat(20000)}"}`), /too large/)

  // Legal, occasionally deliberate, and almost always a mistake.
  const anyOne = createConfig({ label: '1-of-3', threshold: 1, members: [{ pubkey: KEY_A }, { pubkey: KEY_B }, { pubkey: KEY_C }] })
  const warnings = validateConfig(anyOne)
  check('a threshold of 1 is warned about', warnings.some((w) => w.severity === 'warning' && /on their own/.test(w.message)), warnings)

  const everyone = createConfig({ label: '3-of-3', threshold: 3, members: [{ pubkey: KEY_A }, { pubkey: KEY_B }, { pubkey: KEY_C }] })
  check(
    'requiring every member is warned about',
    validateConfig(everyone).some((w) => /locks the account permanently/.test(w.message))
  )

  const duplicate = createConfig({ label: 'dupe', threshold: 2, members: [{ pubkey: KEY_A }, { pubkey: KEY_A }] })
  check('a duplicated member is warned about', validateConfig(duplicate).some((w) => /listed twice/.test(w.message)))
}

/* -------------------------------------------------------------------------- */
/* The document members sign                                                   */
/* -------------------------------------------------------------------------- */

const BASE_DOC: SignDocInput = {
  chainId: 'secret-4',
  accountNumber: '12345',
  sequence: '7',
  fee: { amount: [{ denom: 'uscrt', amount: '2500' }], gas: '25000' },
  memo: 'vector',
  msgs: [
    {
      type: 'cosmos-sdk/MsgSend',
      value: { from_address: MULTISIG_2OF3, to_address: ADDRESS_A, amount: [{ denom: 'uscrt', amount: '1000' }] }
    }
  ]
}

function testSignDoc(): void {
  const doc = buildSignDoc(BASE_DOC)
  const bytes = new TextDecoder().decode(signBytes(doc))

  check('sign bytes are deterministic', signBytesHash(doc) === signBytesHash(buildSignDoc(BASE_DOC)))
  check('keys are sorted', bytes.startsWith('{"account_number":"12345","chain_id":"secret-4","fee":'), bytes.slice(0, 60))
  check('a document equals itself', docsEqual(doc, buildSignDoc(BASE_DOC)))

  // Every field a proposal carries has to change the signature, or a collector
  // could alter it after the fact and the signatures would still verify.
  const changes: Array<[string, SignDocInput]> = [
    ['the memo', { ...BASE_DOC, memo: 'other' }],
    ['the sequence', { ...BASE_DOC, sequence: '8' }],
    ['the account number', { ...BASE_DOC, accountNumber: '1' }],
    ['the chain', { ...BASE_DOC, chainId: 'pulsar-3' }],
    ['the gas limit', { ...BASE_DOC, fee: { ...BASE_DOC.fee, gas: '30000' } }],
    ['the fee amount', { ...BASE_DOC, fee: { amount: [{ denom: 'uscrt', amount: '1' }], gas: '25000' } }],
    ['the fee granter', { ...BASE_DOC, fee: { ...BASE_DOC.fee, granter: ADDRESS_B } }],
    [
      'the recipient',
      {
        ...BASE_DOC,
        msgs: [
          {
            type: 'cosmos-sdk/MsgSend',
            value: { from_address: MULTISIG_2OF3, to_address: ADDRESS_C, amount: [{ denom: 'uscrt', amount: '1000' }] }
          }
        ]
      }
    ]
  ]

  for (const [what, altered] of changes) {
    const other = buildSignDoc(altered)
    check(`changing ${what} changes the signature`, !docsEqual(doc, other))
  }

  // The granter deserves its own assertion rather than living in the list
  // above: the transaction assembler exists because of it.
  const granted = buildSignDoc({ ...BASE_DOC, fee: { ...BASE_DOC.fee, granter: ADDRESS_B } })
  check('the granter is inside the signed bytes', new TextDecoder().decode(signBytes(granted)).includes(`"granter":"${ADDRESS_B}"`))

  // Amino escapes these three characters inside strings. A memo containing one
  // is not exotic — it is a URL with a query string.
  const escaped = buildSignDoc({ ...BASE_DOC, memo: 'a&b<c>d' })
  const escapedBytes = new TextDecoder().decode(signBytes(escaped))
  check('& < > are escaped in the signed bytes', escapedBytes.includes('a\\u0026b\\u003cc\\u003ed'), escapedBytes.slice(0, 120))

  // Absent, not zero: a document carrying `timeout_height` is a different
  // document, and the body the assembler builds never has one.
  check('no timeout height is emitted', !new TextDecoder().decode(signBytes(doc)).includes('timeout_height'))
}

/* -------------------------------------------------------------------------- */
/* Assembling the transaction                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The same 2-of-3, signed offline by members A and C at account number 12345
 * and sequence 7, combined by `secretcli tx multisign` and printed with
 * `secretcli tx encode`. Reproducing this byte for byte is what says our
 * assembler and the reference implementation agree — about signature order,
 * about the bit array, about every field of `AuthInfo`.
 *
 *   secretcli tx bank send <multisig> <A> 1000uscrt --chain-id secret-4 \
 *     --generate-only --gas 25000 --fees 2500uscrt --gas-prices "" --note vector
 *   secretcli tx sign unsigned.json --from ms_a --multisig ms_2of3 --offline \
 *     --account-number 12345 --sequence 7 --sign-mode amino-json …
 *   secretcli tx multisign unsigned.json ms_2of3 sig_a.json sig_c.json --offline …
 */
const CLI_SIGNED_TX =
  'CpgBCo0BChwvY29zbW9zLmJhbmsudjFiZXRhMS5Nc2dTZW5kEm0KLXNlY3JldDE3am11c2d3M2RrdGswdWFqaHBlemFkanZ4' +
  'cmR6d2RmMnUwOTl1ZBItc2VjcmV0MXZneWFlcWdtdmxuNzc1NXU3bHk0cjJkeTNsanY5M3dhdzVlczVuGg0KBXVzY3J0EgQx' +
  'MDAwEgZ2ZWN0b3ISvAIKpAIKiAIKKS9jb3Ntb3MuY3J5cHRvLm11bHRpc2lnLkxlZ2FjeUFtaW5vUHViS2V5EtoBCAISRgof' +
  'L2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiECZ80d4ntPtyyhvcEgRZ28nutv8uOAVJEHoWPZoPE7XdkSRgof' +
  'L2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiEDyXnjl+hTSwRPH1mkvveRswmVvAJYonS8/z5F/keODE0SRgof' +
  'L2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiEC3syFiPRm+sopfdmJEVDCv0rA7OzBoFvay6yXposLstcSFRIT' +
  'CgUIAxIBwBIECgIIfxIECgIIfxgHEhMKDQoFdXNjcnQSBDI1MDAQqMMBGoQBCkDAVmYE697nAes/2fN1VZgfMUD3CvmUWCE8' +
  'ApO3KVQ3IRTkTaNWd3VDoOoRHhJBApTQS24j8iS9fAdRy8rQgMJPCkCnVFFo50ufAEDnCfBGkYrRxbYVIrW70zSuzrxRNiNM' +
  'Oj39i6MfcexeKVq8pU1u8E7zmGGN0euKHGnqs9czy6W9'

const SIGNATURE_A = 'wFZmBOve5wHrP9nzdVWYHzFA9wr5lFghPAKTtylUNyEU5E2jVnd1Q6DqER4SQQKU0EtuI/IkvXwHUcvK0IDCTw=='
const SIGNATURE_C = 'p1RRaOdLnwBA5wnwRpGK0cW2FSK1u9M0rs68UTYjTDo9/YujH3HsXilavKVNbvBO85hhjdHrihxp6rPXM8ulvQ=='

function referenceBody(): Uint8Array {
  return buildBodyBytes(
    [
      {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: MsgSend.encode(
          MsgSend.fromPartial({
            fromAddress: MULTISIG_2OF3,
            toAddress: ADDRESS_A,
            amount: [{ denom: 'uscrt', amount: '1000' }]
          })
        ).finish()
      }
    ],
    'vector'
  )
}

function testAssembly(): void {
  const config = sampleConfig()
  const pubkey = thresholdPubkeyFor(config)
  const fee = { amount: [{ denom: 'uscrt', amount: '2500' }], gas: '25000' }

  const assembled = assembleTx({
    pubkey,
    sequence: '7',
    fee,
    bodyBytes: referenceBody(),
    signatures: new Map([
      // Deliberately out of member order: the assembler must place them by the
      // account's own order, not by the order they were collected in.
      [ADDRESS_C, fromBase64(SIGNATURE_C)],
      [ADDRESS_A, fromBase64(SIGNATURE_A)]
    ])
  })

  check('the assembled transaction is byte-identical to secretcli tx multisign', toBase64(assembled) === CLI_SIGNED_TX, {
    ours: toBase64(assembled).slice(0, 80),
    cli: CLI_SIGNED_TX.slice(0, 80)
  })

  const decoded = TxRaw.decode(assembled)
  const body = TxBody.decode(decoded.bodyBytes)
  check('the body carries no timeout height', body.timeoutHeight === 0n, body.timeoutHeight)
  check('the body carries no extension options', body.extensionOptions.length === 0 && body.nonCriticalExtensionOptions.length === 0)
  check('the body carries the memo that was signed', body.memo === 'vector', body.memo)

  const authInfo = AuthInfo.decode(decoded.authInfoBytes)
  check('the sequence is the one that was signed', authInfo.signerInfos[0].sequence === 7n)
  check('the gas limit survives assembly', authInfo.fee?.gasLimit === 25000n)
  const bits = authInfo.signerInfos[0].modeInfo?.multi?.bitarray
  check('three members are recorded in the bit array', bits?.extraBitsStored === 3, bits?.extraBitsStored)
  check('the signing members are A and C, in member order', toBase64(bits?.elems ?? new Uint8Array()) === 'wA==', toBase64(bits?.elems ?? new Uint8Array()))

  // The fee granter is the reason this module exists rather than calling
  // `@cosmjs/stargate`. Assemble with one and it has to come back out.
  const granted = assembleTx({
    pubkey,
    sequence: '7',
    fee: { ...fee, granter: ADDRESS_B },
    bodyBytes: referenceBody(),
    signatures: new Map([
      [ADDRESS_A, fromBase64(SIGNATURE_A)],
      [ADDRESS_C, fromBase64(SIGNATURE_C)]
    ])
  })
  const grantedAuthInfo = AuthInfo.decode(TxRaw.decode(granted).authInfoBytes)
  check('a fee granter survives assembly', grantedAuthInfo.fee?.granter === ADDRESS_B, grantedAuthInfo.fee?.granter)

  // And the same inputs through the upstream helper, so the bug this module
  // works around stays documented by a test rather than by a comment alone.
  check('the granted transaction differs from the ungranted one', toBase64(granted) !== toBase64(assembled))

  refuses(
    'too few signatures are refused',
    () =>
      assembleTx({
        pubkey,
        sequence: '7',
        fee,
        bodyBytes: referenceBody(),
        signatures: new Map([[ADDRESS_A, fromBase64(SIGNATURE_A)]])
      }),
    /1 of the 2 required/
  )

  refuses(
    'a signature from outside the account is refused',
    () =>
      assembleTx({
        pubkey,
        sequence: '7',
        fee,
        bodyBytes: referenceBody(),
        signatures: new Map([
          [ADDRESS_A, fromBase64(SIGNATURE_A)],
          ['secret1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', fromBase64(SIGNATURE_C)]
        ])
      }),
    /not a member/
  )

  refuses(
    'a fee payer is refused',
    () =>
      assembleTx({
        pubkey,
        sequence: '7',
        fee: { ...fee, payer: ADDRESS_B },
        bodyBytes: referenceBody(),
        signatures: new Map([
          [ADDRESS_A, fromBase64(SIGNATURE_A)],
          [ADDRESS_C, fromBase64(SIGNATURE_C)]
        ])
      }),
    /fee payer/
  )

  // The bit array is the part most likely to be got wrong by hand.
  check('an empty bit array stores no extra bits', compactBitArray([]).extraBitsStored === 0)
  check('one set bit sits in the most significant position', toBase64(compactBitArray([true]).elems) === 'gA==')
  check('nine bits spill into a second byte', compactBitArray(new Array(9).fill(true)).elems.length === 2)
}

/* -------------------------------------------------------------------------- */

function main(): void {
  console.log('Multisig\n')
  testDerivation()
  testFingerprint()
  testConfig()
  testSignDoc()
  testAssembly()

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
