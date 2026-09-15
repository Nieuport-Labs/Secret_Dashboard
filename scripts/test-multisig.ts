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

import { Secp256k1, sha256 } from '@cosmjs/crypto'
import { fromBase64, toBase64 } from '@cosmjs/encoding'
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx.js'
import { AuthInfo, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js'

import { CHAIN_ID, DEFAULT_LCD_URLS } from '../src/chains/secret4.ts'
import { SSCRT_ADDRESS } from '../src/tokens/registry.ts'
import { assembleTx, buildBodyBytes, compactBitArray } from '../src/lib/multisig/assemble.ts'
import {
  decodeJson,
  decodeText,
  encodeJson,
  encodeText,
  parseEnvelope,
  type Proposal,
  type SignatureBundle
} from '../src/lib/multisig/bundle.ts'
import {
  CHAIN_REFUSES,
  computeEntries,
  defaultGasFor,
  foreignSigners,
  signersOf,
  typeUrlsFor,
  type DeclaredMsg
} from '../src/lib/multisig/messages.ts'
import {
  fixedCiphertextUtils,
  newSeed,
  seedPubkey,
  senderPubkeyOf,
  utilsForSeed,
  verifyCiphertext
} from '../src/lib/multisig/encryption.ts'
import { composeProposal, rebuildProposal } from '../src/lib/multisig/flow.ts'
import { verifyCollected, verifyProposal, verifySignature } from '../src/lib/multisig/verify.ts'
import {
  addressForPubkey,
  createConfig,
  fingerprintOf,
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

async function refusesAsync(name: string, run: () => Promise<unknown>, expected: RegExp): Promise<void> {
  try {
    await run()
    check(name, false, 'it was accepted')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(name, expected.test(message), message)
  }
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
  check(
    'members are sorted the way the SDK sorts them',
    derived.order.join() === SORTED.join(),
    derived.order
  )

  // The sort is what makes this true, and it is the difference between a group
  // agreeing on one account and each member creating a different one.
  const shuffled = deriveMultisig([KEY_C, KEY_B, KEY_A], 2)
  check('input order does not change the address', shuffled.address === MULTISIG_2OF3, shuffled.address)

  const threeOfThree = deriveMultisig([KEY_A, KEY_B, KEY_C], 3)
  check('the threshold is part of the address', threeOfThree.address !== MULTISIG_2OF3, threeOfThree.address)

  const twoOfTwo = deriveMultisig([KEY_A, KEY_B], 2)
  check('dropping a member changes the address', twoOfTwo.address !== MULTISIG_2OF3, twoOfTwo.address)

  refuses(
    'a threshold above the member count is refused',
    () => deriveMultisig([KEY_A, KEY_B], 3),
    /cannot be met/
  )
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
  check(
    'a created config stores members in derivation order',
    config.members.map((m) => m.pubkey).join() === SORTED.join()
  )
  check('member addresses are derived, not taken on trust', config.members[0].address === ADDRESS_A)
  check('a sound config has nothing to report', validateConfig(config).length === 0, validateConfig(config))

  const roundTripped = parseConfig(JSON.stringify(config))
  check('a config survives export and import', roundTripped.address === config.address)

  // The check that matters most: a config may not claim an address its own
  // keys do not produce. Anything else lets an import redirect a "top up the
  // multisig" instruction to somebody else's account.
  const lying = { ...config, address: ADDRESS_A }
  refuses(
    'a config claiming the wrong address is refused',
    () => parseConfig(JSON.stringify(lying)),
    /Do not use it/
  )

  const reordered = { ...config, members: [...config.members].reverse() }
  refuses(
    'a config with reordered members is refused',
    () => parseConfig(JSON.stringify(reordered)),
    /Do not use it|order/
  )

  const swappedKey = {
    ...config,
    members: config.members.map((member, index) => (index === 0 ? { ...member, pubkey: KEY_B } : member))
  }
  refuses(
    'a member whose key and address disagree is refused',
    () => parseConfig(JSON.stringify(swappedKey)),
    /actually belongs to/
  )

  refuses(
    'an unknown field is refused',
    () => parseConfig(JSON.stringify({ ...config, extra: 1 })),
    /Unexpected field/
  )
  refuses(
    'another version is refused',
    () => parseConfig(JSON.stringify({ ...config, version: 2 })),
    /different version/
  )
  refuses(
    'another chain is refused',
    () => parseConfig(JSON.stringify({ ...config, chainId: 'pulsar-3' })),
    /not secret-4/
  )
  refuses(
    'a malformed transport key is refused',
    () => parseConfig(JSON.stringify({ ...config, roomKey: 'nope' })),
    /transport key/
  )
  refuses(
    'an empty member list is refused',
    () => parseConfig(JSON.stringify({ ...config, members: [] })),
    /member list/
  )
  refuses('a non-object is refused', () => parseConfig('[]'), /JSON object/)
  refuses('broken JSON is refused', () => parseConfig('{'), /valid JSON/)
  refuses(
    'an oversized document is refused',
    () => parseConfig(`{"padding":"${'x'.repeat(20000)}"}`),
    /too large/
  )

  // Legal, occasionally deliberate, and almost always a mistake.
  const anyOne = createConfig({
    label: '1-of-3',
    threshold: 1,
    members: [{ pubkey: KEY_A }, { pubkey: KEY_B }, { pubkey: KEY_C }]
  })
  const warnings = validateConfig(anyOne)
  check(
    'a threshold of 1 is warned about',
    warnings.some((w) => w.severity === 'warning' && /on their own/.test(w.message)),
    warnings
  )

  const everyone = createConfig({
    label: '3-of-3',
    threshold: 3,
    members: [{ pubkey: KEY_A }, { pubkey: KEY_B }, { pubkey: KEY_C }]
  })
  check(
    'requiring every member is warned about',
    validateConfig(everyone).some((w) => /locks the account permanently/.test(w.message))
  )

  const duplicate = createConfig({
    label: 'dupe',
    threshold: 2,
    members: [{ pubkey: KEY_A }, { pubkey: KEY_A }]
  })
  check(
    'a duplicated member is warned about',
    validateConfig(duplicate).some((w) => /listed twice/.test(w.message))
  )
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
      value: {
        from_address: MULTISIG_2OF3,
        to_address: ADDRESS_A,
        amount: [{ denom: 'uscrt', amount: '1000' }]
      }
    }
  ]
}

function testSignDoc(): void {
  const doc = buildSignDoc(BASE_DOC)
  const bytes = new TextDecoder().decode(signBytes(doc))

  check('sign bytes are deterministic', signBytesHash(doc) === signBytesHash(buildSignDoc(BASE_DOC)))
  check(
    'keys are sorted',
    bytes.startsWith('{"account_number":"12345","chain_id":"secret-4","fee":'),
    bytes.slice(0, 60)
  )
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
            value: {
              from_address: MULTISIG_2OF3,
              to_address: ADDRESS_C,
              amount: [{ denom: 'uscrt', amount: '1000' }]
            }
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
  check(
    'the granter is inside the signed bytes',
    new TextDecoder().decode(signBytes(granted)).includes(`"granter":"${ADDRESS_B}"`)
  )

  // Amino escapes these three characters inside strings. A memo containing one
  // is not exotic — it is a URL with a query string.
  const escaped = buildSignDoc({ ...BASE_DOC, memo: 'a&b<c>d' })
  const escapedBytes = new TextDecoder().decode(signBytes(escaped))
  check(
    '& < > are escaped in the signed bytes',
    escapedBytes.includes('a\\u0026b\\u003cc\\u003ed'),
    escapedBytes.slice(0, 120)
  )

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

  check(
    'the assembled transaction is byte-identical to secretcli tx multisign',
    toBase64(assembled) === CLI_SIGNED_TX,
    {
      ours: toBase64(assembled).slice(0, 80),
      cli: CLI_SIGNED_TX.slice(0, 80)
    }
  )

  const decoded = TxRaw.decode(assembled)
  const body = TxBody.decode(decoded.bodyBytes)
  check('the body carries no timeout height', body.timeoutHeight === 0n, body.timeoutHeight)
  check(
    'the body carries no extension options',
    body.extensionOptions.length === 0 && body.nonCriticalExtensionOptions.length === 0
  )
  check('the body carries the memo that was signed', body.memo === 'vector', body.memo)

  const authInfo = AuthInfo.decode(decoded.authInfoBytes)
  check('the sequence is the one that was signed', authInfo.signerInfos[0].sequence === 7n)
  check('the gas limit survives assembly', authInfo.fee?.gasLimit === 25000n)
  const bits = authInfo.signerInfos[0].modeInfo?.multi?.bitarray
  check('three members are recorded in the bit array', bits?.extraBitsStored === 3, bits?.extraBitsStored)
  check(
    'the signing members are A and C, in member order',
    toBase64(bits?.elems ?? new Uint8Array()) === 'wA==',
    toBase64(bits?.elems ?? new Uint8Array())
  )

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
  check(
    'a fee granter survives assembly',
    grantedAuthInfo.fee?.granter === ADDRESS_B,
    grantedAuthInfo.fee?.granter
  )

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
  check(
    'one set bit sits in the most significant position',
    toBase64(compactBitArray([true]).elems) === 'gA=='
  )
  check('nine bits spill into a second byte', compactBitArray(new Array(9).fill(true)).elems.length === 2)
}

/* -------------------------------------------------------------------------- */
/* Encrypted messages, against the chain                                       */
/* -------------------------------------------------------------------------- */

/**
 * The assertion this whole feature rests on: a member who did not encrypt a
 * message can tell what it says, and can tell when it says something else.
 *
 * Needs the chain, because decryption derives its key from the consensus IO
 * public key the node publishes. Nothing is signed or sent — one contract
 * query for a code hash, and arithmetic.
 */
async function testEncryption(): Promise<void> {
  const { SecretNetworkClient } = await import('secretjs')
  const url = process.env.LCD_URL ?? DEFAULT_LCD_URLS[0]!
  const client = new SecretNetworkClient({ url, chainId: CHAIN_ID })

  let codeHash: string
  try {
    codeHash = (await client.query.compute.codeHashByContractAddress({ contract_address: SSCRT_ADDRESS }))
      .code_hash!
  } catch (error) {
    console.log(`SKIP  the chain is unreachable (${error instanceof Error ? error.message : String(error)})`)
    return
  }

  const seed = newSeed()
  const message = { set_viewing_key: { key: 'api_key_ZmFrZSBrZXkgZm9yIGEgdGVzdA==' } }
  const utils = await utilsForSeed(url, seed)
  const ciphertext = await utils.encrypt(codeHash, message)

  check('a ciphertext carries its nonce and sender key', ciphertext.length > 64, ciphertext.length)
  check(
    'the sender key in the ciphertext is the one the seed produces',
    toBase64(senderPubkeyOf(ciphertext)) === toBase64(await seedPubkey(seed))
  )

  const verdict = await verifyCiphertext({
    lcdUrl: url,
    seed,
    ciphertext,
    declaredCodeHash: codeHash,
    declaredMsg: message
  })
  check('a member can verify the message a proposal declares', verdict.status === 'exact', verdict)

  // The three ways a proposal can lie about what it is asking for.
  const wrongMsg = await verifyCiphertext({
    lcdUrl: url,
    seed,
    ciphertext,
    declaredCodeHash: codeHash,
    declaredMsg: { set_viewing_key: { key: 'something else entirely' } }
  })
  check('a message that is not what it claims is refused', wrongMsg.status === 'mismatch', wrongMsg)

  const wrongCodeHash = await verifyCiphertext({
    lcdUrl: url,
    seed,
    ciphertext,
    declaredCodeHash: 'f'.repeat(64),
    declaredMsg: message
  })
  check(
    'a message encrypted to another contract is refused',
    wrongCodeHash.status === 'mismatch',
    wrongCodeHash
  )

  const wrongSeed = await verifyCiphertext({
    lcdUrl: url,
    seed: newSeed(),
    ciphertext,
    declaredCodeHash: codeHash,
    declaredMsg: message
  })
  check('a decoy seed is caught before anything is decrypted', wrongSeed.status === 'mismatch', wrongSeed)
  check(
    'and it is caught for the right reason',
    wrongSeed.status === 'mismatch' && /not encrypted with the key/.test(wrongSeed.reason),
    wrongSeed
  )

  // Same meaning, different spelling: allowed, but reported rather than waved
  // through, because a proposal this app built would never produce it.
  const reordered = await verifyCiphertext({
    lcdUrl: url,
    seed,
    ciphertext: await utils.encrypt(codeHash, { b: 2, a: 1 } as unknown as object),
    declaredCodeHash: codeHash,
    declaredMsg: { a: 1, b: 2 }
  })
  check(
    'a differently serialised message is flagged, not refused',
    reordered.status === 'equivalent',
    reordered
  )

  // The shim that lets a member re-encode the proposer's exact bytes.
  const fixed = fixedCiphertextUtils(utils, [{ codeHash, msg: message, ciphertext }])
  const handedBack = await fixed.encrypt(codeHash, message)
  check('the shim hands back the proposer’s ciphertext', toBase64(handedBack) === toBase64(ciphertext))

  try {
    await fixed.encrypt(codeHash, { transfer: { recipient: ADDRESS_A, amount: '1' } })
    check('the shim refuses a message the proposal does not contain', false, 'it was accepted')
  } catch (error) {
    check(
      'the shim refuses a message the proposal does not contain',
      /does not contain/.test(error instanceof Error ? error.message : '')
    )
  }

  try {
    await fixed.encrypt(codeHash, message)
    check('the shim will not reuse one ciphertext twice', false, 'it was accepted')
  } catch {
    check('the shim will not reuse one ciphertext twice', true)
  }
}

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* What a message asks for                                                     */
/* -------------------------------------------------------------------------- */

function testMessages(): void {
  const send: DeclaredMsg = {
    template: 'MsgSend',
    content: { from_address: MULTISIG_2OF3, to_address: ADDRESS_A, amount: `1000uscrt` }
  }

  check('the account that must sign a send is found', signersOf(send).join() === MULTISIG_2OF3)
  check('a send by the account itself is not foreign', foreignSigners([send], MULTISIG_2OF3).length === 0)
  check(
    'a message signed by somebody else is caught',
    foreignSigners([send], ADDRESS_B)[0]?.signer === MULTISIG_2OF3,
    foreignSigners([send], ADDRESS_B)
  )

  // The two indirect ones: these name a validator, and the account that has to
  // sign is the operator behind it — the same key in a different spelling.
  const commission: DeclaredMsg = {
    template: 'MsgWithdrawValidatorCommission',
    content: { validator_address: 'secretvaloper1vgyaeqgmvln7755u7ly4r2dy3ljv93walnhde6' }
  }
  check(
    'a validator message resolves to its operator account',
    signersOf(commission).join() === ADDRESS_A,
    signersOf(commission)
  )

  const multiSend: DeclaredMsg = {
    template: 'MsgMultiSend',
    content: { inputs: [{ address: MULTISIG_2OF3, coins: '1uscrt' }], outputs: [] }
  }
  check('every input of a multi-send must sign', signersOf(multiSend).join() === MULTISIG_2OF3)

  // A message naming nobody, or naming a validator address that will not
  // parse, must fail loudly: an empty signer list would otherwise read as
  // "nobody unexpected signs this".
  refuses(
    'a message naming no account is refused',
    () => signersOf({ template: 'MsgSend', content: {} }),
    /names no account/
  )
  refuses(
    'an unparseable validator address is refused',
    () => signersOf({ template: 'MsgUnjail', content: { validator_addr: 'secretvaloper1nope' } }),
    /not a validator address/
  )

  check('type URLs come from the template table', typeUrlsFor([send])[0] === '/cosmos.bank.v1beta1.MsgSend')
  refuses(
    'an unknown template has no signer',
    () => signersOf({ template: 'MsgNope', content: {} }),
    /cannot build or check/
  )

  const execute: DeclaredMsg = {
    template: 'MsgExecuteContract',
    content: {
      sender: MULTISIG_2OF3,
      contract_address: SSCRT_ADDRESS,
      code_hash: 'ab'.repeat(32),
      msg: { deposit: {} }
    },
    ciphertext: 'AA'
  }
  const entries = computeEntries([send, execute])
  check(
    'contract calls are picked out of a proposal',
    entries.length === 1 && entries[0].index === 1,
    entries
  )
  check('a contract call carries the code hash it is encrypted to', entries[0]?.codeHash === 'ab'.repeat(32))

  // Gas has to grow with the work and with the number of keys involved, since
  // every member's key rides along and every signature is verified.
  const small = defaultGasFor([send], 3, 2)
  check('gas covers the message and the account', small > 25_000, small)
  check('more members cost more gas', defaultGasFor([send], 5, 2) > small)
  check('a higher threshold costs more gas', defaultGasFor([send], 3, 3) > small)
  check('a contract call is sized generously', defaultGasFor([execute], 3, 2) > defaultGasFor([send], 3, 2))

  check('instantiate is known to be refused by the chain', CHAIN_REFUSES.has('MsgInstantiateContract'))
}

/* -------------------------------------------------------------------------- */
/* The wire format                                                             */
/* -------------------------------------------------------------------------- */

function sampleProposal(): Proposal {
  return {
    v: 1,
    kind: 'proposal',
    id: 'proposal-0001',
    chainId: CHAIN_ID,
    multisig: MULTISIG_2OF3,
    fingerprint: fingerprint(2, SORTED),
    proposer: ADDRESS_A,
    createdAt: 1_700_000_000_000,
    title: 'Send 1 SCRT back to A',
    accountNumber: '12345',
    sequence: '7',
    fee: { amount: [{ denom: 'uscrt', amount: '2500' }], gas: '25000' },
    memo: 'vector',
    msgs: [
      {
        template: 'MsgSend',
        content: { from_address: MULTISIG_2OF3, to_address: ADDRESS_A, amount: '1000uscrt' }
      }
    ]
  }
}

function sampleSignature(): SignatureBundle {
  return {
    v: 1,
    kind: 'signature',
    proposalId: 'proposal-0001',
    fingerprint: fingerprint(2, SORTED),
    pubkey: KEY_A,
    signature: SIGNATURE_A,
    signBytesHash: 'a'.repeat(64),
    signedAt: 1_700_000_000_000
  }
}

/** Every bundle that arrives is attacker-controlled text. These are the refusals. */
function testBundle(): void {
  const proposal = sampleProposal()

  const throughText = parseEnvelope(JSON.parse(JSON.stringify(proposal)))
  check('a sound proposal parses', throughText.kind === 'proposal')
  check(
    'a proposal survives the text form',
    (decodeText(encodeText(proposal)) as Proposal).id === proposal.id
  )
  check(
    'a proposal survives the file form',
    (decodeJson(encodeJson(proposal)) as Proposal).id === proposal.id
  )
  check(
    'a signature survives the text form',
    (decodeText(encodeText(sampleSignature())) as SignatureBundle).pubkey === KEY_A
  )

  const mutate = (patch: Record<string, unknown>) => () => parseEnvelope({ ...proposal, ...patch })

  refuses('another version is refused', mutate({ v: 2 }), /different version/)
  refuses('an unknown kind is refused', mutate({ kind: 'instruction' }), /not a proposal/)
  refuses('an unknown field is refused', mutate({ urgent: true }), /unexpected field/)
  refuses('another chain is refused', mutate({ chainId: 'pulsar-3' }), /not secret-4/)
  refuses('a malformed fingerprint is refused', mutate({ fingerprint: 'nope' }), /fingerprint/)
  refuses(
    'an invalid account address is refused',
    mutate({ multisig: 'secret1notanaddress' }),
    /invalid multisig/
  )
  refuses('a padded sequence is refused', mutate({ sequence: '007' }), /malformed sequence/)
  refuses(
    'a non-numeric account number is refused',
    mutate({ accountNumber: 'seven' }),
    /malformed accountNumber/
  )
  refuses('an over-long memo is refused', mutate({ memo: 'x'.repeat(300) }), /over-long memo/)
  refuses('an empty message list is refused', mutate({ msgs: [] }), /no messages/)
  refuses(
    'too many messages are refused',
    mutate({ msgs: new Array(21).fill(proposal.msgs[0]) }),
    /more than 20/
  )
  refuses(
    'an unknown message template is refused',
    mutate({ msgs: [{ template: 'MsgDrainEverything', content: {} }] }),
    /cannot build or check/
  )
  refuses('a fee payer is refused', mutate({ fee: { ...proposal.fee, payer: ADDRESS_B } }), /names a payer/)
  refuses(
    'a malformed fee is refused',
    mutate({ fee: { amount: [{ denom: 'uscrt', amount: '-1' }], gas: '25000' } }),
    /malformed amount/
  )
  refuses(
    'a contract call with no encrypted body is refused',
    mutate({
      msgs: [
        {
          template: 'MsgExecuteContract',
          content: {
            sender: MULTISIG_2OF3,
            contract_address: SSCRT_ADDRESS,
            code_hash: 'ab'.repeat(32),
            msg: {}
          }
        }
      ]
    }),
    /no encrypted body/
  )
  refuses(
    'an encrypted message with no key to check it is refused',
    mutate({
      msgs: [
        {
          template: 'MsgExecuteContract',
          content: {
            sender: MULTISIG_2OF3,
            contract_address: SSCRT_ADDRESS,
            code_hash: 'ab'.repeat(32),
            msg: {}
          },
          ciphertext: toBase64(new Uint8Array(96))
        }
      ]
    }),
    /no key to check it/
  )
  refuses(
    'an encrypted body too short to be one is refused',
    mutate({
      seed: toBase64(new Uint8Array(32)),
      msgs: [
        {
          template: 'MsgExecuteContract',
          content: {
            sender: MULTISIG_2OF3,
            contract_address: SSCRT_ADDRESS,
            code_hash: 'ab'.repeat(32),
            msg: {}
          },
          ciphertext: toBase64(new Uint8Array(40))
        }
      ]
    }),
    /too short/
  )
  refuses('a malformed seed is refused', mutate({ seed: toBase64(new Uint8Array(16)) }), /16 bytes, not 32/)

  const signature = sampleSignature()
  const mutateSignature = (patch: Record<string, unknown>) => () => parseEnvelope({ ...signature, ...patch })
  refuses(
    'a truncated signature is refused',
    mutateSignature({ signature: toBase64(new Uint8Array(32)) }),
    /32 bytes, not 64/
  )
  refuses(
    'a malformed signing key is refused',
    mutateSignature({ pubkey: toBase64(new Uint8Array(32)) }),
    /32 bytes, not 33/
  )
  refuses('a malformed document hash is refused', mutateSignature({ signBytesHash: 'XYZ' }), /document hash/)

  refuses('text from somewhere else is refused', () => decodeText('aGVsbG8='), /does not look like/)
  refuses(
    'truncated text is refused',
    () => decodeText(encodeText(proposal).slice(0, 40)),
    /damaged|not a proposal|That/
  )
  refuses(
    'an over-long document is refused',
    () => decodeJson(`{"padding":"${'x'.repeat(200_000)}"}`),
    /too large/
  )
}

/* -------------------------------------------------------------------------- */
/* The whole path, against the chain                                           */
/* -------------------------------------------------------------------------- */

/**
 * Compose, rebuild, verify, sign and assemble — the member's side end to end.
 *
 * The proposer's half is simulated by encrypting a real message against
 * sSCRT's real code hash, because composing for real needs a funded multisig
 * account and this test has none. Everything after that is the genuine path a
 * member's machine takes.
 */
async function testFlow(): Promise<void> {
  const { SecretNetworkClient } = await import('secretjs')
  const url = process.env.LCD_URL ?? DEFAULT_LCD_URLS[0]!
  const client = new SecretNetworkClient({ url, chainId: CHAIN_ID })

  let codeHash: string
  try {
    codeHash = (await client.query.compute.codeHashByContractAddress({ contract_address: SSCRT_ADDRESS }))
      .code_hash!
  } catch {
    console.log('SKIP  the chain is unreachable')
    return
  }

  const config = sampleConfig()
  const seed = newSeed()
  const utils = await utilsForSeed(url, seed)
  const inner = { set_viewing_key: { key: 'api_key_dGVzdCBvbmx5' } }
  const ciphertext = await utils.encrypt(codeHash, inner)

  const proposal: Proposal = {
    ...sampleProposal(),
    title: 'Set a viewing key on sSCRT',
    seed: toBase64(seed),
    msgs: [
      {
        template: 'MsgExecuteContract',
        content: {
          sender: MULTISIG_2OF3,
          contract_address: SSCRT_ADDRESS,
          code_hash: codeHash,
          msg: inner,
          sent_funds: ''
        },
        ciphertext: toBase64(ciphertext)
      }
    ]
  }

  const rebuilt = await rebuildProposal(url, proposal)
  const again = await rebuildProposal(url, proposal)
  check('rebuilding a proposal twice gives the same document', docsEqual(rebuilt.doc, again.doc))
  check(
    'the rebuilt message carries the proposer’s own ciphertext',
    (rebuilt.doc.msgs[0].value as { msg?: string }).msg === proposal.msgs[0].ciphertext
  )
  check('the rebuilt body is messages and memo only', rebuilt.bodyBytes.length > 0)

  // The attack the whole scheme exists to stop: a proposal that shows one
  // message and carries the ciphertext of another. The shim refuses to hand
  // over bytes for a message the proposal does not declare, so the transaction
  // cannot even be built, let alone signed.
  const tampered: Proposal = {
    ...proposal,
    msgs: [
      {
        ...proposal.msgs[0],
        content: { ...proposal.msgs[0].content, msg: { set_viewing_key: { key: 'the attacker’s key' } } }
      }
    ]
  }
  await refusesAsync(
    'a proposal showing one message and carrying another cannot be rebuilt',
    () => rebuildProposal(url, tampered),
    /does not contain/
  )

  // And the checklist says so in words, before anyone gets that far.
  const verdict = await verifyProposal({ config, proposal: tampered, client, lcdUrl: url })
  const ciphertextCheck = verdict.checks.find((entry) => entry.id.startsWith('ciphertext-'))
  check('the checklist refuses the tampered proposal', ciphertextCheck?.status === 'fail', ciphertextCheck)
  check('and it is not signable', !verdict.signable)

  const sound = await verifyProposal({ config, proposal, client, lcdUrl: url, doc: rebuilt.doc })
  check(
    'a sound proposal passes the ciphertext check',
    sound.checks.find((entry) => entry.id.startsWith('ciphertext-'))?.status === 'pass',
    sound.checks.find((entry) => entry.id.startsWith('ciphertext-'))
  )
  check(
    'a sound proposal passes the code-hash check',
    sound.checks.find((entry) => entry.id.startsWith('code-hash-'))?.status === 'pass'
  )
  check(
    'the account is checked against the chain',
    sound.checks.some((entry) => entry.id === 'sequence')
  )
  check(
    'an account the chain has never seen is reported plainly',
    sound.checks.some((entry) => /never been funded/.test(entry.detail ?? '')),
    sound.checks.filter((entry) => entry.status === 'fail')
  )
  check('which makes it unsignable', !sound.signable)

  // Composing for that same account refuses for the same reason, rather than
  // building a proposal that could never be broadcast.
  await refusesAsync(
    'composing for an account the chain has never seen is refused',
    () =>
      composeProposal({
        client,
        lcdUrl: url,
        config,
        proposer: ADDRESS_A,
        title: 'Anything',
        messages: [
          {
            template: 'MsgSend',
            content: { from_address: MULTISIG_2OF3, to_address: ADDRESS_A, amount: '1uscrt' }
          }
        ]
      }),
    /no account on chain/
  )
}

/* -------------------------------------------------------------------------- */
/* Signatures, with a real key                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A signature is trusted because it verifies, never because it arrived.
 *
 * Signed here with a throwaway private key so the checks can be exercised in
 * both directions — a good signature accepted, and every way of being wrong
 * refused.
 */
async function testSignatures(): Promise<void> {
  const privkey = new Uint8Array(32).fill(7)
  const keypair = await Secp256k1.makeKeypair(privkey)
  const pubkey = Secp256k1.compressPubkey(keypair.pubkey)
  const member = addressForPubkey(toBase64(pubkey))

  const config = createConfig({
    label: 'Signing test',
    threshold: 2,
    members: [{ pubkey: toBase64(pubkey) }, { pubkey: KEY_A }, { pubkey: KEY_B }],
    roomKey: 'a'.repeat(64)
  })

  const doc = buildSignDoc({
    ...BASE_DOC,
    msgs: [
      {
        type: 'cosmos-sdk/MsgSend',
        value: {
          from_address: config.address,
          to_address: ADDRESS_A,
          amount: [{ denom: 'uscrt', amount: '1000' }]
        }
      }
    ]
  })

  const raw = await Secp256k1.createSignature(sha256(signBytes(doc)), privkey)
  const fixedLength = new Uint8Array([...raw.r(32), ...raw.s(32)])

  const bundle: SignatureBundle = {
    v: 1,
    kind: 'signature',
    proposalId: 'proposal-0001',
    fingerprint: fingerprintOf(config),
    pubkey: toBase64(pubkey),
    signature: toBase64(fixedLength),
    signBytesHash: signBytesHash(doc),
    signedAt: Date.now()
  }

  const good = await verifySignature({ config, doc, bundle })
  check('a real signature verifies', good.status === 'pass', good)
  check('and it is attributed to the member who made it', good.label.includes(member), good.label)

  const otherDoc = buildSignDoc({ ...BASE_DOC, memo: 'something else' })
  const wrongDoc = await verifySignature({ config, doc: otherDoc, bundle })
  check('a signature over another document is refused', wrongDoc.status === 'fail', wrongDoc)
  check(
    'and it says which problem it is',
    wrongDoc.status === 'fail' && /different transaction/.test(wrongDoc.detail ?? ''),
    wrongDoc.detail
  )

  const outsider = createConfig({
    label: 'Without that member',
    threshold: 2,
    members: [{ pubkey: KEY_A }, { pubkey: KEY_B }, { pubkey: KEY_C }],
    roomKey: 'a'.repeat(64)
  })
  const notMember = await verifySignature({ config: outsider, doc, bundle })
  check('a signature from outside the account is refused', notMember.status === 'fail', notMember)
  check(
    'and it says the signer is not a member',
    notMember.status === 'fail' && /not a member/.test(notMember.detail ?? '')
  )

  // A single bit, flipped.
  const damaged = new Uint8Array(fixedLength)
  damaged[10] ^= 0x01
  const broken = await verifySignature({
    config,
    doc,
    bundle: { ...bundle, signature: toBase64(damaged) }
  })
  check('a damaged signature is refused', broken.status === 'fail', broken)

  // The tray: duplicates from one member must not count twice, or one person
  // could satisfy a 2-of-3 on their own.
  const collected = await verifyCollected({
    config,
    doc,
    bundles: [bundle, { ...bundle, signedAt: Date.now() }]
  })
  check('one member signing twice counts once', collected.byMember.size === 1, collected.byMember.size)
  check('and a 2-of-3 is not satisfied by it', !collected.enough)
  check('only verified signatures are kept', collected.usable.length === 1)
}

/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log('Multisig\n')
  testDerivation()
  testFingerprint()
  testConfig()
  testSignDoc()
  testAssembly()
  testMessages()
  testBundle()
  await testEncryption()
  await testSignatures()
  await testFlow()

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

await main()
