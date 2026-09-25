/**
 * Tests for the rules auto-refill and easy mode hang on: how much a refill
 * takes, and which tokens may be unwrapped.
 *
 *   npm run test:refill
 */

// zustand's persist reads `window.localStorage`; nothing here needs it to work.
Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })

const { CREDIT_FLOOR, splitRefill } = await import('../src/lib/autoRefill.ts')
const { canUnwrap } = await import('../src/store/settings.ts')
const { SSCRT_ADDRESS } = await import('../src/tokens/registry.ts')
const { bestSimulated, findRoutes, quoteOut, swapIn, swapMessage, swapOut } =
  await import('../src/lib/shadeSwap.ts')

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

const SCRT = 1_000_000n

{
  const split = (sscrt: bigint, scrt: bigint) => splitRefill(sscrt * SCRT, scrt * SCRT)
  const is = (got: ReturnType<typeof split>, sscrt: bigint, scrt: bigint, short: bigint) =>
    got.fromSscrt === sscrt && got.fromScrt === scrt && got.short === short

  check('plenty of sSCRT: 5 of it, nothing else', is(split(100n, 100n), 5n * SCRT, 0n, 0n))
  check('some sSCRT, the rest from SCRT', is(split(2n, 100n), 2n * SCRT, 3n * SCRT, 0n))
  check('no sSCRT: all 5 from SCRT', is(split(0n, 100n), 0n, 5n * SCRT, 0n))
  check(
    'SCRT is spent to the last unit, nothing held back',
    is(split(1n, 2n), 1n * SCRT, 2n * SCRT, 2n * SCRT)
  )
  check(
    'nothing at all: all 5 short, which is the swap or the notice',
    is(split(0n, 0n), 0n, 0n, CREDIT_FLOOR)
  )
  check(
    "except this transaction's own fee, when the wallet pays it",
    splitRefill(0n, 1n * SCRT, 50_000n).fromScrt === 1n * SCRT - 50_000n
  )
  check(
    'and a balance smaller than that fee spends nothing',
    splitRefill(0n, 10_000n, 50_000n).fromScrt === 0n
  )
}

const ATOM = 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe'
check('easy mode unwraps sSCRT', canUnwrap('easy', SSCRT_ADDRESS))
check('easy mode does not unwrap anything else', !canUnwrap('easy', ATOM))
check('unanswered counts as easy', !canUnwrap(undefined, ATOM))
check('expert mode unwraps anything', canUnwrap('expert', ATOM))

/* Pool arithmetic ---------------------------------------------------------- */

// A pool of 1,000,000 X against 2,000,000 Y with a 0.3% fee.
const X = 1_000_000_000_000n
const Y = 2_000_000_000_000n
const FEE_NUM = 3n
const FEE_DEN = 1000n

{
  const out = swapOut(X, Y, 1_000_000n, FEE_NUM, FEE_DEN)
  // 1 X at 2 Y each, less 0.3%, less a hair of price impact.
  check('a small trade gets the price less the fee', out > 1_993_000n && out <= 1_994_000n, out.toString())

  const back = swapIn(X, Y, out, FEE_NUM, FEE_DEN)!
  check('the inverse asks at least what was paid', back >= 1_000_000n, back.toString())
  check('and not much more', back - 1_000_000n < 10n, back.toString())
  check('what it asks for really buys the amount', swapOut(X, Y, back, FEE_NUM, FEE_DEN) >= out)
}

check('nothing in, nothing out', swapOut(X, Y, 0n, FEE_NUM, FEE_DEN) === 0n)
check('asking for the whole pool is refused', swapIn(X, Y, Y, FEE_NUM, FEE_DEN) === undefined)

{
  const ref = (address: string) => ({ address, codeHash: 'h' })
  const pair = (address: string, a: string, b: string) => ({
    contract: ref(address),
    token0: ref(a),
    token1: ref(b),
    stable: false
  })
  const pairs = [
    pair('p1', 'ATOM', 'SILK'),
    pair('p2', 'SILK', 'SSCRT'),
    pair('p3', 'ATOM', 'SSCRT'),
    pair('p4', 'USDC', 'SILK')
  ]

  const routes = findRoutes(pairs, 'ATOM', 'SSCRT')
  check(
    'a direct pair is a route',
    routes.some((route) => route.length === 1 && route[0].pair.contract.address === 'p3')
  )
  check(
    'and so is two hops through a shared token',
    routes.some(
      (route) => route.length === 2 && route[0].to.address === 'SILK' && route[1].to.address === 'SSCRT'
    )
  )
  check(
    'with every hop pointing the right way',
    routes.every((route) => route[0].from.address === 'ATOM')
  )
  check('a token with no way there has no route', findRoutes(pairs, 'OSMO', 'SSCRT').length === 0)
}

{
  const ref = (address: string) => ({ address, codeHash: 'h' })
  const pair = (address: string, a: string, b: string, stable = false) => ({
    contract: ref(address),
    token0: ref(a),
    token1: ref(b),
    stable
  })
  // USDC to ATOM the way ShadeSwap has it: the direct pool is empty, and the
  // way through is a stable pool into SILK, or three constant-product hops.
  const pairs = [
    pair('direct', 'USDC', 'ATOM'),
    pair('usdc-silk', 'USDC', 'SILK', true),
    pair('silk-atom', 'SILK', 'ATOM'),
    pair('usdc-sscrt', 'USDC', 'SSCRT'),
    pair('sscrt-silk', 'SSCRT', 'SILK')
  ]
  const routes = findRoutes(pairs, 'USDC', 'ATOM')
  check(
    'routes go up to three hops',
    routes.some((route) => route.length === 3),
    routes.length
  )
  check(
    'shortest first',
    routes.every((route, index) => index === 0 || routes[index - 1].length <= route.length)
  )
  check(
    'and never through the same token twice',
    routes.every((route) => new Set(route.map((hop) => hop.to.address)).size === route.length)
  )

  const reserves = new Map(
    pairs.map((p) => [
      p.contract.address,
      {
        amount0: p.contract.address === 'direct' ? 0n : 10n ** 12n,
        amount1: p.contract.address === 'direct' ? 0n : 10n ** 12n,
        feeNum: 3n,
        feeDen: 1000n
      }
    ])
  )
  const viaStable = routes.find((route) => route.some((hop) => hop.pair.stable))!
  check(
    'arithmetic does not price a route through a stable pool',
    quoteOut(viaStable, reserves, 1000n) === undefined
  )
  const direct = routes.find((route) => route.length === 1)!
  check('nor through an empty pool', quoteOut(direct, reserves, 1000n) === undefined)

  // A fake router: a curve that is not constant-product, with a fee.
  const ROUTER = 'secret1nrnh30ant2dplrlvqjgmddg4fntllwlm0pnhss'
  const BATCH = 'secret15mkmad8ac036v4nrpcc7nk8wyr578egt077syt'
  const curve = (amountIn: bigint) => (amountIn * 1_950n) / 1_000n - (amountIn * amountIn) / 10n ** 9n
  let simulations = 0
  type SimQuery = { swap_simulation: { offer: { amount: string } } }
  const answer = (query: SimQuery) => {
    simulations += 1
    return {
      swap_simulation: {
        result: { return_amount: curve(BigInt(query.swap_simulation.offer.amount)).toString() }
      }
    }
  }
  const client = {
    query: {
      compute: {
        codeHashByContractAddress: async ({ contract_address }: { contract_address: string }) => ({
          code_hash: contract_address === 'USDC' ? 'current' : 'h'
        }),
        queryContract: async ({
          contract_address,
          query
        }: {
          contract_address: string
          query: { batch: { queries: Array<{ id: string; query: string }> } } & SimQuery
        }) => {
          if (contract_address === BATCH) {
            return {
              batch: {
                responses: query.batch.queries.map((item: { id: string; query: string }) => ({
                  id: item.id,
                  response: {
                    response: btoa(JSON.stringify(answer(JSON.parse(atob(item.query)) as SimQuery)))
                  }
                }))
              }
            }
          }
          if (contract_address === ROUTER) return answer(query)
          throw new Error('unexpected ' + contract_address)
        }
      }
    }
  } as unknown as import('secretjs').SecretNetworkClient

  const target = 5_000_000n
  const quote = await bestSimulated(client, [viaStable], reserves, target, () => 100n)
  const out = quote ? curve(quote.amountIn) : 0n
  check(
    'a stable route is priced by the router: enough comes out, padded by the slippage, and not much more',
    quote !== undefined &&
      quote.amountOut === (target * 10_000n) / 9_900n &&
      out >= quote.amountOut &&
      (out - quote.amountOut) * 10_000n <= quote.amountOut * 30n,
    { amountIn: quote?.amountIn.toString(), out: out.toString(), simulations }
  )
  check('in a few requests', simulations <= 6, simulations)
  check(
    'and not at all past the first, when it cannot beat what arithmetic found',
    (await bestSimulated(client, [viaStable], reserves, target, () => 100n, 1_000n)) === undefined
  )

  const message = (await swapMessage(client, 'secret1me', viaStable, 100n, 90n)) as unknown as {
    contractAddress: string
    codeHash: string
    msg: { send: { msg: string } }
  }
  const path = (
    JSON.parse(atob(message.msg.send.msg)) as {
      swap_tokens_for_exact: { path: Array<{ token0: { code_hash: string } }> }
    }
  ).swap_tokens_for_exact.path
  check(
    "the swap goes to the token under its current code hash, not the pair's old record of it",
    message.contractAddress === 'USDC' && message.codeHash === 'current',
    message
  )
  check("while the path keeps the pair's record, which the router checks", path[0].token0.code_hash === 'h')
}

{
  const { bestExactOut } = await import('../src/lib/gasPurchase.ts')
  const ref = (address: string) => ({ address, codeHash: 'h' })
  const pair = (address: string, a: string, b: string) => ({
    contract: ref(address),
    token0: ref(a),
    token1: ref(b),
    stable: false
  })
  // A direct pool a little dearer than a three-hop way round.
  const pairs = [
    pair('d', 'USDC', 'SSCRT'),
    pair('a', 'USDC', 'X'),
    pair('b', 'X', 'Y'),
    pair('c', 'Y', 'SSCRT')
  ]
  const deep = 10n ** 15n
  const reserves = new Map([
    ['d', { amount0: deep, amount1: (deep * 97n) / 100n, feeNum: 3n, feeDen: 1000n }],
    ['a', { amount0: deep, amount1: deep, feeNum: 0n, feeDen: 1000n }],
    ['b', { amount0: deep, amount1: deep, feeNum: 0n, feeDen: 1000n }],
    ['c', { amount0: deep, amount1: deep, feeNum: 0n, feeDen: 1000n }]
  ])
  const routes = findRoutes(pairs, 'USDC', 'SSCRT')
  const fee = (route: { length: number }) => BigInt(route.length) * 35_000n
  const small = 1_000_000n
  check('on price alone, the longer route wins', bestExactOut(routes, reserves, small)?.route.length === 3)
  check(
    "with each hop's fee counted, a small purchase takes the direct pool",
    bestExactOut(routes, reserves, small, fee)?.route.length === 1
  )
  check(
    'and a large one still the longer route, where the fees are small beside the price',
    bestExactOut(routes, reserves, 1_000_000_000n, fee)?.route.length === 3
  )
}

{
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key)
    }
  })
  const { gasLimitFor, rememberGasUsed } = await import('../src/lib/gasMemory.ts')
  check('an unseen shape gets the hand-sized limit', gasLimitFor('buy:x', 2_200_000) === 2_200_000)
  rememberGasUsed('buy:x', 1_406_932)
  rememberGasUsed('buy:x', 1_390_000)
  const learned = gasLimitFor('buy:x', 2_200_000)
  check(
    'a seen one gets what it used, with a small margin over the most',
    learned > 1_406_932 && learned < 1_600_000,
    learned
  )
  check('shapes are kept apart', gasLimitFor('buy:y', 2_200_000) === 2_200_000)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
