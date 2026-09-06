# Secret Dashboard 1.9

An entry point into [Secret Network](https://scrt.network) — wallet, bridge, staking and the
Secret dApp ecosystem, for `secret-4` (mainnet).

A ground-up rewrite of [dash.scrt.network](https://github.com/SecretFoundation/dash.scrt.network),
built around four things the original does not do:

- **SNIP-24 query permits instead of viewing keys.** Read your own SNIP-20 balances without first
  paying for a transaction to be allowed to.
- **SNIP-52 private push notifications instead of polling.** The chain tells you when something
  arrives, rather than the app asking sixty times a minute.
- **Fee grants on every transaction, and gas credits you can buy.** Someone else can pay your gas,
  including a vault contract you pay once and draw down.
- **Get gas at bridge time.** Arriving on Secret with no SCRT means you cannot sign anything —
  not even the transaction that would get you gas. A slice of what you bridge is swapped and
  turned into gas credits _in flight_, so an empty wallet still works.

## Running it

```bash
npm install
npm run dev
```

Opens on port 3000.

| Script                 | What it does                                                   |
| ---------------------- | -------------------------------------------------------------- |
| `npm run dev`          | Development server                                             |
| `npm run build`        | Type-check and build for production                            |
| `npm run preview`      | Serve the production build                                     |
| `npm run lint`         | ESLint                                                         |
| `npm run typecheck`    | `tsc --noEmit`                                                 |
| `npm run verify:chain` | Check every chain assumption the app rests on, against mainnet |
| `npm run test:bridge`  | Gas-slice sizing and IBC memo shapes                           |

`verify:chain` is read-only and needs no wallet. Run it when something behaves oddly before
suspecting the app — it will tell you whether an endpoint is lying about which chain it serves,
whether the gas vault still answers, and which SNIP-52 channels a token actually offers. Its
findings are written up in [`docs/chain-facts.md`](docs/chain-facts.md).

## Stack

Vite 7, React 19, TypeScript, Tailwind, [secretjs](https://github.com/scrtlabs/secret.js),
[Lucide](https://lucide.dev) for every icon, and
[`@solar-republic/neutrino`](https://github.com/SolarRepublic/neutrino) for SNIP-52.

Design tokens live as CSS custom properties in `src/styles/tokens.css` and components reference
tokens, never hex — which is what makes the light theme a matter of redefining a dozen values.
The typeface is Google Sans Flex, self-hosted rather than fetched from Google's CDN.

## Credits

The token registry, IBC auto-wrap memo format and network data sources are adapted from
[dash.scrt.network](https://github.com/SecretFoundation/dash.scrt.network), MIT licensed,
developed by [Secret Saturn](https://x.com/Secret_Saturn_) and
[Secret Jupiter](https://x.com/secretjupiter_).

The fee grant SDK, gas vault contract and endpoint probing come from
[fee-granter](https://github.com/jirkacepelka/fee-granter).
