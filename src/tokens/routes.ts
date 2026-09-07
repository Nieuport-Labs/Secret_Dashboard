import { DENOM } from '@/chains/secret4'

/**
 * Which tokens can travel between which chains, and under what denomination.
 *
 * Adapted from dash.scrt.network's token table (MIT). 156 Axelar routes were
 * dropped rather than carried over: those connections have been disabled since
 * the 2026-06-10 drain and offering them would send someone's tokens into a
 * closed channel.
 *
 * A route names the denomination the token wears on each side. That is the part
 * nobody can guess: the same asset is `uatom` on Cosmos Hub and an `ibc/…` hash
 * on Secret, and getting it wrong sends a transfer that succeeds and delivers
 * nothing recognisable.
 */

export interface Route {
  /** SNIP-20 contract on Secret. The token's identity throughout this app. */
  token: string
  /** The other end. */
  chainId: string
  /** Denomination on the *sending* side of this direction. */
  denom: string
  /** Overrides the chain's default channel when the token uses its own. */
  channel?: string
  /** Overrides the chain's default gas limit. */
  gas?: number
  /**
   * Needs more than one hop, so the packet has to be forwarded. Not offered
   * until route planning lands; see docs/chain-facts.md.
   */
  needsSkip?: boolean
}

/** Source chain → Secret. `denom` is what the token is called on the source chain. */
export const DEPOSIT_ROUTES: Route[] = [
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'agoric-3',
    denom: 'ibc/A358D7F19237777AF6D8AD0E0F53268F8B18AE8A53ED318095C14D6D7F3B2DB5'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'akashnet-2',
    denom: 'ibc/13BD0905CFB705ABF84B60209C44071878C9F07A0A2CAC5EDBE315AD3CFD1DF2'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'andromeda-1',
    denom: 'ibc/BCEFD8175B8C47D712FB639034128CB43776364B79E3251F073CB3A2A32582A0'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'archway-1',
    denom: 'ibc/A848807F524E08C87BF9B95275D29D892A2248E9C4A602C3FF9B69607CCDC5C5'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'axelar-dojo-1',
    denom: 'ibc/5B0968D76C6250F0824BD0BB4317DB34E884A14B345C83FB8256809855AC7CA7'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'carbon-1',
    denom: 'ibc/CC36D2DA1A9C865D5F4B5AEA0E2534B9D6F7EB00708DC4010EA3C008CA94C566'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'celestia',
    denom: 'ibc/E3459360643C2555C57C7DAB0567FA762B42D5D6D45A76615EA7D99D933AEC04'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'cheqd-mainnet-1',
    denom: 'ibc/C0DD602D2B4CA12D9BB1FEEEF23D0042473264FFB8A7D88CEDE4FAACC628FADF'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'chihuahua-1',
    denom: 'ibc/EB2CED20AB0466F18BE49285E56B31306D4C60438A022EA995BA65D5E3CF7E09'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'comdex-1',
    denom: 'ibc/345D30E8ED06B47FC538ED131D99D16126F07CD6F8B35DE96AAF4C1E445AF466'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'centauri-1',
    denom: 'ibc/E3459360643C2555C57C7DAB0567FA762B42D5D6D45A76615EA7D99D933AEC04'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'cosmoshub-4',
    denom: 'ibc/1542F8DC70E7999691E991E1EDEB1B47E65E3A217B1649D347098EE48ACB580F'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'dydx-mainnet-1',
    denom: 'ibc/BCEFD8175B8C47D712FB639034128CB43776364B79E3251F073CB3A2A32582A0'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'dymension_1100-1',
    denom: 'ibc/27A5DE18D796A595123D97078F9AB9EAEFC23540724384F219EACED2BD5511F5'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'gravity-bridge-3',
    denom: 'ibc/7907EA1A11FD4FC2A815FCAA54948C42F08E3F3C874EE48861386286FEB80160'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'injective-1',
    denom: 'ibc/0954E1C28EB7AF5B72D24F3BC2B47BBB2FDF91BDDFD57B74B99E133AED40972A'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'jackal-1',
    denom: 'ibc/BCEFD8175B8C47D712FB639034128CB43776364B79E3251F073CB3A2A32582A0'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'juno-1',
    denom: 'ibc/B55B08EF3667B0C6F029C2CC9CAA6B00788CF639EBB84B34818C85CBABA33ABD'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'kava_2222-10',
    denom: 'ibc/858E8F84975386C05ACEA58773CAB72A8A25723AC125BADDFEB4B3728F6F343A'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'kaiyo-1',
    denom: 'ibc/A358D7F19237777AF6D8AD0E0F53268F8B18AE8A53ED318095C14D6D7F3B2DB5'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'neutron-1',
    denom: 'ibc/65B87CDCFF063AA994D79CC7496E059A4F1C692E200541CDF46BF375943E9BD0',
    needsSkip: true
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'noble-1',
    denom: 'ibc/1B28CD5F3CDC17E585A7F2F05931FA694B3EFF0233D98CEF3505A35410D53CED'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'pirin-1',
    denom: 'ibc/EA00FFF0335B07B5CD1530B7EB3D2C710620AE5B168C71AFF7B50532D690E107',
    needsSkip: true
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'nyx',
    denom: 'ibc/5B0968D76C6250F0824BD0BB4317DB34E884A14B345C83FB8256809855AC7CA7'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'omniflixhub-1',
    denom: 'ibc/5525109335A779338DD22D3E902A6C01249927A8A1A74B89F8DC67402106A858'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'Oraichain',
    denom: 'ibc/39059F9BEE8D596554114E02A2C15441DCA885A86B3669733BF5B8D7C3FA49D6'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'osmosis-1',
    denom: 'ibc/0954E1C28EB7AF5B72D24F3BC2B47BBB2FDF91BDDFD57B74B99E133AED40972A'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'core-1',
    denom: 'ibc/8AD0356E16A8EC966F71C62016EECF54239762CC276BA1BAB4F954423951CF5C'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'quicksilver-2',
    denom: 'ibc/0EE32E83564D18F2268A003A0088FC656E05341E5FCA400732DD08994CF9E25F'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'ssc-1',
    denom: 'ibc/1B28CD5F3CDC17E585A7F2F05931FA694B3EFF0233D98CEF3505A35410D53CED'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'sentinelhub-2',
    denom: 'ibc/31FEE1A2A9F9C01113F90BD0BBCCE8FD6BBB8585FAF109A2101827DD1D5B95B8'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'stargaze-1',
    denom: 'ibc/B55B08EF3667B0C6F029C2CC9CAA6B00788CF639EBB84B34818C85CBABA33ABD'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'stride-1',
    denom: 'ibc/563C6CB7E0423BE8B9FD1DAB9EAC201A6C2413D96F73618240B114CE4896734C'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'phoenix-1',
    denom: 'ibc/10BD6ED30BA132AB96F146D71A23B46B2FC19E7D79F52707DC91F2F3A45040AD'
  },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'umee-1',
    denom: 'ibc/6CDC150BDB3B4391C5ED7EB53014C12D92E0316B08C3E7499DAC65CA0673517A'
  },
  { token: 'secret168j5f78magfce5r2j4etaytyuy7ftjkh4cndqw', chainId: 'akashnet-2', denom: 'uakt' },
  {
    token: 'secret10fnn57cdxqksgqprtvp27d3ykkgyffv9n0gnal',
    chainId: 'migaloo-1',
    denom: 'factory/migaloo1pll95yfcnxd5pkkrcsad63l929m4ehk4c46fpqqp3c2d488ca0csc220d0/ampBTC'
  },
  {
    token: 'secret1pf6n6j8xlkxnga5t8w8exdtvcrrjgqms5wdlnj',
    chainId: 'kaiyo-1',
    denom: 'factory/kujira1n3fr5f56r2ce0s37wdvwrk98yhhq3unnxgcqus8nzsfxvllk0yxquurqty/ampKUJI'
  },
  {
    token: 'secret1cycwquhh63qmc0qgfe76eed6a6yj5x4vzlu3rc',
    chainId: 'phoenix-1',
    denom: 'cw20:terra1ecgazyd0waaj3g7l9cmy5gulhxkps2gmxu9ghducvuypjq68mq2s5lvsct',
    channel: 'channel-382'
  },
  {
    token: 'secret1jsaftfxnwwmjxccvc3zqaqmkcpp8fjnvvltvq6',
    chainId: 'migaloo-1',
    denom: 'factory/migaloo1436kxs0w2es6xlqpp9rd35e3d0cjnw4sv8j3a7483sgks29jqwgshqdky4/ampWHALE'
  },
  { token: 'secret1dks96n3jz64dyulzjnjazt6cqemr0x0qgn7sd7', chainId: 'andromeda-1', denom: 'uandr' },
  { token: 'secret188z7hncvphw4us4h6uy6vlq4qf20jd2vm2vu8c', chainId: 'archway-1', denom: 'aarch' },
  { token: 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe', chainId: 'cosmoshub-4', denom: 'uatom' },
  {
    token: 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe',
    chainId: 'osmosis-1',
    denom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
    needsSkip: true
  },
  {
    token: 'secret17xw4pelwmmhftscrdfntudyv77rkdxvaaelzvs',
    chainId: 'injective-1',
    denom: 'factory/inj1dxp690rd86xltejgfq2fa7f2nxtgmm5cer3hvu/bINJ'
  },
  {
    token: 'secret1ve536yukullq5rm67gdpssm23wynfv9gcqh6xn',
    chainId: 'kaiyo-1',
    denom: 'factory/kujira15e8q5wzlk5k38gjxlhse3vu6vqnafysncx2ltexd6y9gx50vuj2qpt7dgv/boneKuji'
  },
  { token: 'secret1uxvpq889uxjcpj656yjjexsqa3zqm6ntkyjsjq', chainId: 'agoric-3', denom: 'ubld' },
  {
    token: 'secret1wzqxaa6g6xa27vrwgygex8xurxdjzjtwzlgwy3',
    chainId: 'phoenix-1',
    denom: 'cw20:terra17aj4ty4sz4yhgm08na8drc0v03v2jwr3waxcqrwhajj729zhl7zqnpc0ml',
    channel: 'channel-382'
  },
  { token: 'secret1lfqlcnpveh6at723h5k2nu4jjqeuz0ukpxxdtt', chainId: 'cheqd-mainnet-1', denom: 'ncheq' },
  { token: 'secret1mndng80tqppllk0qclgcnvccf9urak08e9w2fl', chainId: 'comdex-1', denom: 'ucmdx' },
  { token: 'secret14l7s0evqw7grxjlesn8yyuk5lexuvkwgpfdxr5', chainId: 'comdex-1', denom: 'ucmst' },
  { token: 'secret1e8p373krsxva4msh0gdh94lg3rhn7npgmd5g8v', chainId: 'coreum-mainnet-1', denom: 'ucore' },
  {
    token: 'secret1x3cxgrwymk7yyelf2782r8ay020xyl96zq3rhh',
    chainId: 'neutron-1',
    denom: 'factory/neutron1k6hr0f83e7un2wjf29cspk7j69jrnskk65k3ek2nj9dztrlzpj6q00rtsa/udatom'
  },
  {
    token: 'secret1h5d3555tz37crrgl5rppu2np2fhaugq3q8yvv9',
    chainId: 'centauri-1',
    denom: 'ibc/3CC19CEC7E5A3E90E78A5A9ECC5A0E2F8F826A375CF1E096F4515CF09DA3E366'
  },
  { token: 'secret15qtw24mpmwkjessr46dnqruq4s4tstzf74jtkf', chainId: 'sentinelhub-2', denom: 'udvpn' },
  { token: 'secret13lndcagy53wfzh69rtv0dex3a7cks0dv5emwke', chainId: 'dydx-mainnet-1', denom: 'adydx' },
  { token: 'secret1vfe63g7ndhqq9qu8v4n97fj69rcmr5fy0dun75', chainId: 'dymension_1100-1', denom: 'adym' },
  {
    token: 'secret1r4cldegd4peufgtaxf0qpagclqspeqaf8dm0l9',
    chainId: 'neutron-1',
    denom: 'factory/neutron10sr06r3qkhn7xzpw3339wuj77hu06mzna6uht0/eclip'
  },
  { token: 'secret1agpgsn50xjdggzdzd6kl4jz5ueywtkuhnyyhx5', chainId: 'omniflixhub-1', denom: 'uflix' },
  { token: 'secret1dtghxvrx35nznt8es3fwxrv4qh56tvxv22z79d', chainId: 'gravity-bridge-3', denom: 'ugraviton' },
  { token: 'secret1lrlkqhmwkh5y4326akn3hwn6j69f8l5656m43e', chainId: 'comdex-1', denom: 'uharbor' },
  { token: 'secret1ntvxnf5hzhzv8g87wn76ch6yswdujqlgmjh32w', chainId: 'chihuahua-1', denom: 'uhuahua' },
  { token: 'secret14706vxakdzkz9a36872cs62vpl5qd84kpwvpew', chainId: 'injective-1', denom: 'inj' },
  { token: 'secret1xmqsk8tnge0atzy4e079h0l2wrgz6splcq0a24', chainId: 'agoric-3', denom: 'uist' },
  { token: 'secret1sgaz455pmtgld6dequqayrdseq8vy2fc48n8y3', chainId: 'jackal-1', denom: 'ujkl' },
  { token: 'secret1z6e4skg5g9w65u5sqznrmagu05xq8u6zjcdg4a', chainId: 'juno-1', denom: 'ujuno' },
  { token: 'secret1xyhphws090fqs33sxkytmagwynz54eqnpdqfrw', chainId: 'kava_2222-10', denom: 'ukava' },
  { token: 'secret13hvh0rn0rcf5zr486yxlrucvwpzwqu2dsz6zu8', chainId: 'kaiyo-1', denom: 'ukuji' },
  {
    token: 'secret1n4dp5dk6fufqmaalu9y7pnmk2r0hs7kc66a55f',
    chainId: 'centauri-1',
    denom: 'ibc/EE9046745AEC0E8302CB7ED9D5AD67F528FB3B7AE044B247FB0FB293DBDA35E9'
  },
  { token: 'secret1yafpcu9wpauy5ktymggzk9kmsvmce0hkl9p2h7', chainId: 'pirin-1', denom: 'unls' },
  {
    token: 'secret16l5g98d45gqvvn2g79q23h8flfq65cvr9r6c72',
    chainId: 'kaiyo-1',
    denom: 'factory/kujira1aaudpfr9y23lt9d45hrmskphpdfaq9ajxd3ukh/unstk'
  },
  { token: 'secret1k644rvd979wn4erjd5g42uehayjwrq094g5uvj', chainId: 'neutron-1', denom: 'untrn' },
  { token: 'secret19gk280z6j9ywt3ln6fmfwfa36dkqeukcwqdw2k', chainId: 'nyx', denom: 'unym' },
  { token: 'secret149e7c5j7w24pljg6em6zj2p557fuyhg8cnk7z8', chainId: 'phoenix-1', denom: 'uluna' },
  {
    token: 'secret1swrj0fqza3g98d7agm2nmukjfe44h7f5n8aavp',
    chainId: 'osmosis-1',
    denom: 'factory/osmo1mlng7pz4pnyxtpq0akfwall37czyk9lukaucsrn30ameplhhshtqdvfm5c/ulvn'
  },
  {
    token: 'secret1h08ru5kul3yajg7tqj6vq9k6rccnfw2yqy8glc',
    chainId: 'osmosis-1',
    denom: 'factory/osmo1f5vfcph2dvfeqcqkhetwv75fda69z7e5c2dldm3kvgj23crkv6wqcn47a0/umilkTIA'
  },
  {
    token: 'secret15rxfz2w2tallu9gr9zjxj8wav2lnz4gl9pjccj',
    chainId: 'kaiyo-1',
    denom: 'factory/kujira1643jxg8wasy5cfcn7xm8rd742yeazcksqlg4d7/umnta'
  },
  { token: 'secret1sv0nxz6athw5qm0hsxl90376c9zhrxhhprhjph', chainId: 'Oraichain', denom: 'orai' },
  { token: 'secret150jec8mc2hzyyqak4umv6cfevelr0x9p0mjxgg', chainId: 'osmosis-1', denom: 'uosmo' },
  {
    token: 'secret1hhvfxy44e4gp6k7n4e37t7uyqa54dnp68egugg',
    chainId: 'gravity-bridge-3',
    denom: 'gravity0x60e683C6514Edd5F758A55b6f393BeBBAfaA8d5e'
  },
  { token: 'secret1e0y9vf4xr9wffyxsvlz35jzl5st2srkdl8frac', chainId: 'centauri-1', denom: 'ppica' },
  {
    token: 'secret1umeg3u5y949vz6jkgq0n4rhefsr84ws3duxmnz',
    chainId: 'core-1',
    denom: 'ibc/A6E3AF63B3C906416A9AF7A556C59EA4BD50E617EFFE6299B99700CCB780E444'
  },
  { token: 'secret120cyurq25uvhkc7qjx7t28deuqslprxkc4rrzc', chainId: 'quicksilver-2', denom: 'uqatom' },
  { token: 'secret17d8c96kezszpda3r2c5dtkzlkfxw6mtu7q98ka', chainId: 'quicksilver-2', denom: 'uqck' },
  {
    token: 'secret1cj2fvj4ap79fl9euz8kqn0k5xlvck0pw9z9xhr',
    chainId: 'kaiyo-1',
    denom: 'factory/kujira1qk00h5atutpsv900x202pxx42npjr9thg58dnqpa72f2p7m2luase444a7/uusk'
  },
  {
    token: 'secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2',
    chainId: 'archway-1',
    denom: 'ibc/43897B9739BD63E3A08A88191999C632E052724AB96BD4C74AE31375C991F48D',
    needsSkip: true
  },
  {
    token: 'secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2',
    chainId: 'neutron-1',
    denom: 'ibc/B559A80D62249C8AA07A380E2A2BEA6E5CA9A6F079C912C3A9E9B494105E4F81',
    needsSkip: true
  },
  { token: 'secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2', chainId: 'noble-1', denom: 'uusdc' },
  {
    token: 'secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2',
    chainId: 'osmosis-1',
    denom: 'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4',
    needsSkip: true
  },
  { token: 'secret19gmvklys9uywk3lf2e94wqwwc97r3jr5rwa2pa', chainId: 'ssc-1', denom: 'usaga' },
  { token: 'secret1x0dqckf2khtxyrjwhlkrx9lwwmz44k24vcv2vv', chainId: 'stargaze-1', denom: 'ustars' },
  {
    token: 'secret155w9uxruypsltvqfygh5urghd5v0zc6f9g69sq',
    chainId: 'osmosis-1',
    denom: 'ibc/C140AFD542AE77BD7DCC83F13FDD8C5E5BB8C4929785E6EC2F4C636F98F17901',
    needsSkip: true
  },
  { token: 'secret155w9uxruypsltvqfygh5urghd5v0zc6f9g69sq', chainId: 'stride-1', denom: 'stuatom' },
  {
    token: 'secret1eurddal3m0tphtapad9awgzcuxwz8ptrdx7h4n',
    chainId: 'osmosis-1',
    denom: 'ibc/C04DFC9BCD893E57F2BEFE40F63EFD18D2768514DBD5F63ABD2FF7F48FC01D36',
    needsSkip: true
  },
  { token: 'secret1eurddal3m0tphtapad9awgzcuxwz8ptrdx7h4n', chainId: 'stride-1', denom: 'stinj' },
  {
    token: 'secret1097nagcaavlkchl87xkqptww2qkwuvhdnsqs2v',
    chainId: 'osmosis-1',
    denom: 'ibc/84502A75BCA4A5F68D464C00B3F610CE2585847D59B52E5FFB7C3C9D2DDCD3FE',
    needsSkip: true
  },
  { token: 'secret1097nagcaavlkchl87xkqptww2qkwuvhdnsqs2v', chainId: 'stride-1', denom: 'stujuno' },
  { token: 'secret16vjfe24un4z7d3sp9vd0cmmfmz397nh2njpw3e', chainId: 'core-1', denom: 'stk/uatom' },
  { token: 'secret16dctnuy6lwydw834f4d0t3sw3f6jhav6ryhe4m', chainId: 'core-1', denom: 'stk/adydx' },
  {
    token: 'secret1rkgvpck36v2splc203sswdr0fxhyjcng7099a9',
    chainId: 'osmosis-1',
    denom: 'ibc/C491E7582E94AE921F6A029790083CDE1106C28F3F6C4AD7F1340544C13EC372',
    needsSkip: true
  },
  { token: 'secret1rkgvpck36v2splc203sswdr0fxhyjcng7099a9', chainId: 'stride-1', denom: 'stuluna' },
  {
    token: 'secret1jrp6z8v679yaq65rndsr970mhaxzgfkymvc58g',
    chainId: 'osmosis-1',
    denom: 'ibc/D176154B0C63D1F9C6DCFB4F70349EBF2E2B5A87A05902F57A6AE92B863E9AEC',
    needsSkip: true
  },
  { token: 'secret1jrp6z8v679yaq65rndsr970mhaxzgfkymvc58g', chainId: 'stride-1', denom: 'stuosmo' },
  {
    token: 'secret1rfhgs3ryqt7makakr2qw9zsqq4h5wdqawfa2aa',
    chainId: 'osmosis-1',
    denom: 'ibc/A8CA5EE328FA10C9519DF6057DA1F69682D28F7D0F5CCC7ECB72E3DCA2D157A4',
    needsSkip: true
  },
  { token: 'secret1rfhgs3ryqt7makakr2qw9zsqq4h5wdqawfa2aa', chainId: 'stride-1', denom: 'ustrd' },
  {
    token: 'secret1l5d0vncwnlln0tz0m4tp9rgm740xl7th6es0q0',
    chainId: 'osmosis-1',
    denom: 'ibc/D176154B0C63D1F9C6DCFB4F70349EBF2E2B5A87A05902F57A6AE92B863E9AEC',
    needsSkip: true
  },
  { token: 'secret1l5d0vncwnlln0tz0m4tp9rgm740xl7th6es0q0', chainId: 'stride-1', denom: 'stutia' },
  { token: 'secret1gech42jfcdke92tf9ltscpq7x0al8j7gkce030', chainId: 'carbon-1', denom: 'swth' },
  {
    token: 'secret1hjcv25hpgqtpwn90tz7pttr9fyz7l9pngzz8rl',
    chainId: 'injective-1',
    denom: 'factory/inj1a6xdezq7a94qwamec6n6cnup02nvewvjtz6h6e/SYN'
  },
  { token: 'secret1s9h6mrp4k9gll4zfv5h78ll68hdq8ml7jrnn20', chainId: 'celestia', denom: 'utia' },
  {
    token: 'secret1s9h6mrp4k9gll4zfv5h78ll68hdq8ml7jrnn20',
    chainId: 'osmosis-1',
    denom: 'ibc/D79E7D83AB399BFFF93433E54FAA480C191248FC556924A2A8351AE2638B3877',
    needsSkip: true
  },
  { token: 'secret1f6yg0typy608r567xekwyn3qf0k902llue9w2l', chainId: 'umee-1', denom: 'uumee' },
  {
    token: 'secret1htd6s29m2j9h45knwkyucz98m306n32hx8dww3',
    chainId: 'kava_2222-10',
    denom: 'erc20/tether/usdt'
  },
  {
    token: 'secret1v2kgmfwgd2an0l5ddralajg5wfdkemxl2vg4jp',
    chainId: 'osmosis-1',
    denom: 'factory/osmo1z0qrq605sjgcqpylfl4aa6s90x738j7m58wyatt0tdzflg2ha26q67k743/wbtc'
  },
  { token: 'secret1pcftk3ny87zm6thuxyfrtrlm2t8yev5unuvx6c', chainId: 'migaloo-1', denom: 'uwhale' },
  {
    token: 'secret1xx6m5c7d92h75evkmxqqe2xe5sk5qcqqs9t8ar',
    chainId: 'neutron-1',
    denom: 'factory/neutron1ug740qrkquxzrk2hh29qrlx3sktkfml3je7juusc2te7xmvsscns0n2wry/wstETH'
  },
  { token: 'secret1gnrrqjj5e2pwn4g262xjyypptu0ge3z3tps3nn', chainId: 'core-1', denom: 'uxprt' },
  {
    token: 'secret1gqn3k7792h9vqpydvq6hnh3wr9lqg3s9j6hzy6',
    chainId: 'coreum-mainnet-1',
    denom: 'drop-core1zhs909jp9yktml6qqx9f0ptcq2xnhhj99cja03j3lfcsp2pgm86studdrz'
  },
  {
    token: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    chainId: 'archway-1',
    denom: 'ibc/E070901F36B129933202BEB3EB40A78BE242D8ECBA2D1AF9161DF06F35783900',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    chainId: 'osmosis-1',
    denom: 'ibc/6EB4508741789F4F2AB4401C7B44D2D1D31B21DCE214F9C96FAEFDF3D706BCEC',
    channel: 'channel-476',
    gas: 700000
  },
  {
    token: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    chainId: 'kaiyo-1',
    denom: 'ibc/41DC488852155D854CC9FE8857716DFAC354546758EDC41299A9465B07E4E2AA',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    chainId: 'juno-1',
    denom: 'ibc/7DC5921D6779809452F0C08F8556C1486153BC6B3F4859059DF03ABB575D5529',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'archway-1',
    denom: 'ibc/9771BBD4AA47F559E61C62CDEB52E50FC55F72C156DE836CF8840C8073BA0C58',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'centauri-1',
    denom: 'ibc/A216C7F8983C75266D9483F6B3AA27396983D7EDF70C9DDF985A6AC7A4E318E7',
    channel: 'channel-26',
    gas: 300000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'juno-1',
    denom: 'ibc/EF64F59ECC75029AB041C75E63AFA49B0CF4A3E3BE938F9980F1A59F06236C5D',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'kaiyo-1',
    denom: 'ibc/E926EC3A30A2FEFBD06F661715305496D5354C0E387DEF368AA276221D47CA0D',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'migaloo-1',
    denom: 'ibc/0E542895B4DBFC878D4684D228A4DF838746EF213670EBB54D5199C849099490',
    channel: 'channel-103',
    gas: 300000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'neutron-1',
    denom: 'ibc/CE43FE0DD3CA328FFD7DC6AC46644F528031E26DF06AA6C5521FD1CE21EDCFC2',
    channel: 'channel-1950',
    gas: 300000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'Oraichain',
    denom: 'ibc/CACE0EE5BFAC7543AD62A7BCE1CDF794BD9858845848C6FE1DE3DF8B38F5FCB1',
    channel: 'channel-222',
    gas: 300000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'osmosis-1',
    denom: 'ibc/957FD3BE8CDBD2416F45F8024F6DD58FE2D64330419B56A7DD1F8744852C879E',
    channel: 'channel-476',
    gas: 300000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'core-1',
    denom: 'ibc/71F169C0E3AED9298A654A311154A50BD4D6EDB20D3002C5A53FFE13D4FA0BDB',
    channel: 'channel-159',
    gas: 300000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'archway-1',
    denom: 'ibc/2F0B0AFD333679E0AA2DAD6C149060EBE17C4E579E2B14298C15F3DE7C8EEBDB',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'centauri-1',
    denom: 'ibc/6488D36DA1EC19C1E4F30FC7B9BA728240C32536CD97F37954A1E50D5FB72194',
    channel: 'channel-26',
    gas: 300000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'juno-1',
    denom: 'ibc/91EC16800824F0B03DE0D1406BDFB99D90047E4A208613BFE6956C0C10ED80BB',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'kaiyo-1',
    denom: 'ibc/883BC2CEA98AD0E06FF6731D21600E91A3FE261435A8BC9CE5651FF9FF4F03F9',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'migaloo-1',
    denom: 'ibc/C6C0A2B10074B37A45B3374FC8C90D8C39092B4F3B173F9CEAE07599ADB66448',
    channel: 'channel-103',
    gas: 300000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'neutron-1',
    denom: 'ibc/8A952E1013BDFFC9DF1ADBAA7DD7EF3D57FBC80A080B3C69EEE4AECF8B85CB03',
    channel: 'channel-1950',
    gas: 300000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'Oraichain',
    denom: 'ibc/4E9FD7445280BC976A2C7C05513D4A588E69593AB0BB0DF158CCAB2E10E2EE3C',
    channel: 'channel-222',
    gas: 300000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'osmosis-1',
    denom: 'ibc/3D1AB84398D485BEEDA32DC3400913A3DF14424E0FA0B782BC80D9E207CB5963',
    channel: 'channel-476',
    gas: 300000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'core-1',
    denom: 'ibc/B639D39A9135E1E8B97D15A0F0B30E46DBFD6E90E725C1B9485848D86E6351B8',
    channel: 'channel-159',
    gas: 300000
  },
  {
    token: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
    chainId: 'osmosis-1',
    denom: 'ibc/18A1B70E3205A48DE8590C0D11030E7146CDBF1048789261D53FFFD7527F8B55',
    channel: 'channel-476',
    gas: 700000
  },
  {
    token: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
    chainId: 'kaiyo-1',
    denom: 'ibc/E4572F1DEAA76A5A7E1280B6E462176A5B1FB716CD1F445E21D9F32A85DD11A8',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
    chainId: 'juno-1',
    denom: 'ibc/CA04C714C4FB122FF83BF4E5D19E4A56CDAF7F1837F66F2D722ADB22C58C7467',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'archway-1',
    denom: 'ibc/ADBCCEC74BFF1E60AB3D98B5139536F43602B4899A6BB67624E799CDF904F4D4',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'centauri-1',
    denom: 'ibc/9F65DE68954295B6547FD2874B2A8EEDB3F779F2D5A637BF04266CC41172E6FF',
    channel: 'channel-26',
    gas: 300000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'juno-1',
    denom: 'ibc/EE2A120F4CCED1551BF9B80DB7611E7698D5691B12FB3329E7605693346E90A7',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'kaiyo-1',
    denom: 'ibc/8E7703F6D67D1EF9330CA8D9866317EFFB1C5752B4955514FF3280BE9A5D2D58',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'migaloo-1',
    denom: 'ibc/14BACC9544FD5CD62C97E3DCE4F0F85F37EEAFE83D27741C3F0994A9CE4B4FFC',
    channel: 'channel-103',
    gas: 300000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'neutron-1',
    denom: 'ibc/20D60242A02E94D9B451A27E30B3EC544BD1F1A8874917512F89E3616D350A1E',
    channel: 'channel-1950',
    gas: 300000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'Oraichain',
    denom: 'ibc/6E585CD2730036F68EDF0BB1F266A540DBA8206D5197364C2EC53EEE0CB51E42',
    channel: 'channel-222',
    gas: 300000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'osmosis-1',
    denom: 'ibc/C77039D62BD613A7FE8698EE3639072F81AAD22C5C50749FC9232DF64E0A981F',
    channel: 'channel-476',
    gas: 300000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'core-1',
    denom: 'ibc/A7F69A5F1A592D60FF0B65E9C1B88F07E7D5F71952DEEEDD5C0BF41DD927728C',
    channel: 'channel-159',
    gas: 300000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'archway-1',
    denom: 'ibc/CE17B49194F49FDD9A0466FFEDD9CF548337CF12A0F459453EF8E9DCE7B249B5',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'centauri-1',
    denom: 'ibc/4B5F0F06D2887965FAA0E288505B97BF4817405BA137525DA7660FD52EF10F92',
    channel: 'channel-26',
    gas: 300000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'juno-1',
    denom: 'ibc/34C9B3F6B10E0D13014420046EF4870A46274B5E42F0E74A85A69944F421425C',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'kaiyo-1',
    denom: 'ibc/D11A43A900D7D511E404875EFED287BC8ACA46830252AD1DBF8B4BD1A47AA17F',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'migaloo-1',
    denom: 'ibc/E18E6BBC7A53F6E44394ED9CACBA23878B2569EF5EA7D70E4F8D0DD6C1B38770',
    channel: 'channel-103',
    gas: 300000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'neutron-1',
    denom: 'ibc/E1BEA78D6334576C23518AEA41DC005482DB6E52A5A03DC60A2C2B299AFEAF99',
    channel: 'channel-1950',
    gas: 300000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'Oraichain',
    denom: 'ibc/12DB5831FFBB55D748ED8B98C7C86B131CEC7F870707644C8889CB9A974BE473',
    channel: 'channel-222',
    gas: 300000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'osmosis-1',
    denom: 'ibc/D2FF1958E5E76E96C3AA86B8F218DB254683359D2312D108341401BC7C01541B',
    channel: 'channel-476',
    gas: 300000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'core-1',
    denom: 'ibc/BD82D11F5D59436CA5B10DD24DD08EF2FCA3BAE73730338D0D93E8F901D48753',
    channel: 'channel-159',
    gas: 300000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'archway-1',
    denom: 'ibc/381C09E1B743A8D893DF43B0861FE77AB2C437ED4BE10CB827A0A38285C11977',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'centauri-1',
    denom: 'ibc/5C85AD7EBA2A29A0279ABDAE65E147ED4A7E5E8ADADC2AE9D0CF9F4137FA85C4',
    channel: 'channel-26',
    gas: 300000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'juno-1',
    denom: 'ibc/82822E87DFB76EDBF5FEA7AF35A5DE48F19C6C60D59F3B08B24A347A67C50383',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'kaiyo-1',
    denom: 'ibc/590CE97A3681BC2058FED1F69B613040209DF3F17B7BD31DFFB8671C4D2CD99B',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'migaloo-1',
    denom: 'ibc/6A171A9A6DBBF5DDB976CD215EAA667641FA8EE35EDC95ACDBF68C810B62F0F5',
    channel: 'channel-103',
    gas: 300000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'neutron-1',
    denom: 'ibc/B6643B477C69060B125279D9FF69EC20189E4D15DC24CF0457E0BAA9DD1A26AE',
    channel: 'channel-1950',
    gas: 300000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'Oraichain',
    denom: 'ibc/56AB68090FE69AE2999EF557FB1C185B1A2E2B0CFD42FE36929EC0152A72CAAA',
    channel: 'channel-222',
    gas: 300000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'osmosis-1',
    denom: 'ibc/0B3D528E74E3DEAADF8A68F393887AC7E06028904D02173561B0D27F6E751D0A',
    channel: 'channel-476',
    gas: 300000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'core-1',
    denom: 'ibc/5D3B6445EA1D7064C4B1CCB588638589529556E1BCBADF13475021B42EA8C73B',
    channel: 'channel-159',
    gas: 300000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'archway-1',
    denom: 'ibc/1A6D6FBCBFCA9E21E730C6DC5CC055BBF6D8CA657D9BA993910846987856B4FA',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'centauri-1',
    denom: 'ibc/E1A1FDFC0C393664E7DEB9AAFA3E727C28E13AA3E82EA66BF555197AD9DB54B6',
    channel: 'channel-26',
    gas: 300000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'juno-1',
    denom: 'ibc/387BEF3BD21B53A98708ABEBB0DAA4FCD90B612CF0568983F293E6A7A4DF3DA5',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'kaiyo-1',
    denom: 'ibc/C2786AAA8E49F710716E57DB2B092858B1C5EA8965428305B98F4C5A1A550F94',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'migaloo-1',
    denom: 'ibc/833AF07E9DCC93D75C210FA3F0081D5F8F84AE4DD93687ED4AFDE3A3DE47F09E',
    channel: 'channel-103',
    gas: 300000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'neutron-1',
    denom: 'ibc/0D52AA0ADBB6DAFE82170221497F0F0BD05A819EB6FFF6551ED67BE7C88D4358',
    channel: 'channel-1950',
    gas: 300000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'Oraichain',
    denom: 'ibc/5DB83866223E64515E02223683A678B915FDD15FCCCF0C7B073628383341A7C8',
    channel: 'channel-222',
    gas: 300000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'osmosis-1',
    denom: 'ibc/77BEE176F08CCC5AFBDFCCB9C63EBDF95D773FE3A0D3A85AC667AD633CE030A7',
    channel: 'channel-476',
    gas: 300000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'core-1',
    denom: 'ibc/52A56EDD3489C0ED48BD3EE0E9C851709418372B8580730CC4C51BDBA8C477B9',
    channel: 'channel-159',
    gas: 300000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'archway-1',
    denom: 'ibc/031C15237839CAF9C4824DDF92858CCB72A8897FBB4812E684C402554516DEF8',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'centauri-1',
    denom: 'ibc/3CD84AF84643D6E4479860635E0C5CE9B75AD2F051771C98BCF9BF742422BF84',
    channel: 'channel-26',
    gas: 300000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'juno-1',
    denom: 'ibc/DD880CA120A69821298FA6ECD7AB10EBCB6624BABE5BD2B7B1EC4C97F75CB4F9',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'kaiyo-1',
    denom: 'ibc/6500A6358F49FAB811A75E689D1B7C3B50AE6921F800569BF83929822EE7A828',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'migaloo-1',
    denom: 'ibc/F68DBD13D4F5E660A121C5DF056FEDE99B945DEC75852619A5D036EE0341DF3C',
    channel: 'channel-103',
    gas: 300000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'neutron-1',
    denom: 'ibc/94D85D1AB75CB0BF9B6818EE317E86A83FA9C5D4140D06E71778B97C1FCAC79C',
    channel: 'channel-1950',
    gas: 300000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'Oraichain',
    denom: 'ibc/F40ED42600BFCC0DB0EBDA4284A30FA2DDB74F995BA9991ABA6B452BAFA19987',
    channel: 'channel-222',
    gas: 300000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'osmosis-1',
    denom: 'ibc/8A025A1E70101E39DE0C0F153E582A30806D3DA16795F6D868A3AA247D2DEDF7',
    channel: 'channel-476',
    gas: 300000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'core-1',
    denom: 'ibc/BC67610F1AA72BE9DEABAC3F3D5A04CEB575DA8DF675B0FDD3FC1A0F02411541',
    channel: 'channel-159',
    gas: 300000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'archway-1',
    denom: 'ibc/8C99BB64082398254E000955816D2B4B879E742DEB49DE49A930BE759D536422',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'centauri-1',
    denom: 'ibc/13AD9D1CD176F98229C46CD3FAF22D588CA13A424CA28479C1E88EC9421540C2',
    channel: 'channel-26',
    gas: 300000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'juno-1',
    denom: 'ibc/D16A9D5D85BCF482A389BA74C5B6E71B9E731CD5C97885C343DC0D64037FE688',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'kaiyo-1',
    denom: 'ibc/A81564DE9A1F0D66D715B508601E27AB89E0FADDE6A3706FC15F8C80BB774563',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'migaloo-1',
    denom: 'ibc/E7E026B5DD193646610A90F539B1545444169747E41BE69E51C3FD54711147A2',
    channel: 'channel-103',
    gas: 300000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'neutron-1',
    denom: 'ibc/83AB1D5C247BD3FFAD768B477CB2F4372F37C64D9588B1137C4DFF45B1492CBE',
    channel: 'channel-1950',
    gas: 300000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'Oraichain',
    denom: 'ibc/3030C71FB3A3C4157ABC205FA3765B6886AD24826F656573DAC80E8C07D26839',
    channel: 'channel-222',
    gas: 300000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'osmosis-1',
    denom: 'ibc/D0E5BF2940FB58D9B283A339032DE88111407AAD7D94A7F1F3EB78874F8616D4',
    channel: 'channel-476',
    gas: 300000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'core-1',
    denom: 'ibc/2109E1D3B5EADB28EF9BD864C3EDACC4E2D61E96A1BF172CEFAEAD7240C52300',
    channel: 'channel-159',
    gas: 300000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'archway-1',
    denom: 'ibc/33844695DB2DB4FD1A443173B6A76BF51703795D7E58537FCB4B36C7402468D9',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'centauri-1',
    denom: 'ibc/35023B7E5800EEF142ADD02891DCC4A4BC285CF0DA40F6AEA8D5C5D2A77CAB6D',
    channel: 'channel-26',
    gas: 300000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'juno-1',
    denom: 'ibc/2F8236315F14819A9B889AD56071A2D7A07958001761937CCA2CE790E84D7A02',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'kaiyo-1',
    denom: 'ibc/9EF72CA88B4D797F856AAB30D587F02EBD4A995A26E822731CC7499186B898BE',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'migaloo-1',
    denom: 'ibc/E30FDFC3EB5ECCAAF5CA673467D9696777415000D70B451B5D497ABD1913D7AF',
    channel: 'channel-103',
    gas: 300000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'neutron-1',
    denom: 'ibc/AFC7F121B25E37CB453CFD3A2F15B4D44823412210BD7125030A69504FF792F0',
    channel: 'channel-1950',
    gas: 300000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'Oraichain',
    denom: 'ibc/58C3AE30E6B238D54C17947F64931731C10F499C941189DF48FF96A1A6FBE776',
    channel: 'channel-222',
    gas: 300000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'osmosis-1',
    denom: 'ibc/A43D9B8AC940D8BC8AA468FA40BFEA171110CC713F61ED9A1A601EB4B93954DC',
    channel: 'channel-476',
    gas: 300000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'core-1',
    denom: 'ibc/960945878574714EBB2E7EB6E6DEA68AE6C16380FF997BADDDCC706A63A84484',
    channel: 'channel-159',
    gas: 300000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'archway-1',
    denom: 'ibc/D1C164D28FB37DAEDD00F570092EDD9AFEAD357FDCFDFAE22C26D72026D2B065',
    channel: 'channel-39',
    gas: 300000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'centauri-1',
    denom: 'ibc/A6B1F13B120A6D76117E4255C921283B94FFEA9DE45C598E91D326D3B5D55091',
    channel: 'channel-26',
    gas: 300000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'juno-1',
    denom: 'ibc/3FD3813DD2A62B5419599BE0800348BBA2AC47B5394D89FA8B51B3E97C92B5CC',
    channel: 'channel-163',
    gas: 300000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'kaiyo-1',
    denom: 'ibc/8EDE55C37F3C8635A552E12311E7D730B577B8CE7DAB3B408C3D9DB7A6800E12',
    channel: 'channel-44',
    gas: 300000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'migaloo-1',
    denom: 'ibc/6730D7016EE2BFD0F768F6A8E0F4C0ADFDAAE3C22CE3F251830869D4AFB68979',
    channel: 'channel-103',
    gas: 300000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'neutron-1',
    denom: 'ibc/16574AA781EC30DA00D5C150831F8C38585A805CE1595144E3C444288342B426',
    channel: 'channel-1950',
    gas: 300000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'Oraichain',
    denom: 'ibc/AAEBD78ED8C53F9EE6EA9073185221FDA7ECF6E28E4358AC08D131B343CD4E6B',
    channel: 'channel-222',
    gas: 300000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'osmosis-1',
    denom: 'ibc/6586290AC431EB1B68172478157E79B9D273E9648BF88779ADB04471C5DB5574',
    channel: 'channel-476',
    gas: 300000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'core-1',
    denom: 'ibc/44A66ACAA427BAC5CA365CD3FF8307A2F5D9CF73172EFEBFE5F5F62BBE076C4F',
    channel: 'channel-159',
    gas: 300000
  }
]

/** Secret → source chain. `denom` is the `ibc/…` hash the token wears on Secret. */
export const WITHDRAW_ROUTES: Route[] = [
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'agoric-3', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'akashnet-2', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'andromeda-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'archway-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'axelar-dojo-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'carbon-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'celestia', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'cheqd-mainnet-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'chihuahua-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'comdex-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'centauri-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'cosmoshub-4', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'dydx-mainnet-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'dymension_1100-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'gravity-bridge-3', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'injective-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'jackal-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'juno-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'kava_2222-10', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'kaiyo-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'neutron-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'noble-1', denom: 'uscrt' },
  {
    token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
    chainId: 'pirin-1',
    denom: 'uscrt',
    needsSkip: true
  },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'omniflixhub-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'Oraichain', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'osmosis-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'core-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'quicksilver-2', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'ssc-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'sentinelhub-2', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'stargaze-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'stride-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'phoenix-1', denom: 'uscrt' },
  { token: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', chainId: 'umee-1', denom: 'uscrt' },
  {
    token: 'secret168j5f78magfce5r2j4etaytyuy7ftjkh4cndqw',
    chainId: 'akashnet-2',
    denom: 'ibc/448B29AB9766D29CC09944EDF6A08573B45A37C55746A45FA3CF53F1B58DF98D'
  },
  {
    token: 'secret10fnn57cdxqksgqprtvp27d3ykkgyffv9n0gnal',
    chainId: 'migaloo-1',
    denom: 'ibc/1C57D32E0F9D94364C6E0F5527125F23DC38BBD6FAEB59E2A7241958FE9E6E93'
  },
  {
    token: 'secret1pf6n6j8xlkxnga5t8w8exdtvcrrjgqms5wdlnj',
    chainId: 'kaiyo-1',
    denom: 'ibc/34B4771B53EF809676E49CE62A5E1872FBD7C9BF4AF248741A22F4998ECB5501'
  },
  {
    token: 'secret1cycwquhh63qmc0qgfe76eed6a6yj5x4vzlu3rc',
    chainId: 'phoenix-1',
    denom: 'ibc/9877130F93E5275DFF468215F4D7924B6D893A105CC807E55BAF51385AFE1544',
    channel: 'channel-127'
  },
  {
    token: 'secret1jsaftfxnwwmjxccvc3zqaqmkcpp8fjnvvltvq6',
    chainId: 'migaloo-1',
    denom: 'ibc/3EFE4B646CE2EFCA3787ED861AFDC5A37BAEDB3B905A64BAE796D2366D1AB473'
  },
  {
    token: 'secret1dks96n3jz64dyulzjnjazt6cqemr0x0qgn7sd7',
    chainId: 'andromeda-1',
    denom: 'ibc/55D94A32095A766971637425D998AAABF8357A1ABCB1CAC8614887BE51BF1FB1'
  },
  {
    token: 'secret188z7hncvphw4us4h6uy6vlq4qf20jd2vm2vu8c',
    chainId: 'archway-1',
    denom: 'ibc/64C032841EC8FEDFEA08C89B1AE8CEB5D616533C7CFC02158B83F221D8AE5618'
  },
  {
    token: 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe',
    chainId: 'cosmoshub-4',
    denom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'
  },
  {
    token: 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe',
    chainId: 'osmosis-1',
    denom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
    needsSkip: true
  },
  {
    token: 'secret17xw4pelwmmhftscrdfntudyv77rkdxvaaelzvs',
    chainId: 'injective-1',
    denom: 'ibc/80AC7AD18ECAFF2306DC59598C2FE663BF8A674264FF8D9B3124C3146C44394C'
  },
  {
    token: 'secret1ve536yukullq5rm67gdpssm23wynfv9gcqh6xn',
    chainId: 'kaiyo-1',
    denom: 'ibc/DE7E34CB2C4A3D278B405307F8982DE7FAE921D4D20855E1DBD469330434B2FB'
  },
  {
    token: 'secret1uxvpq889uxjcpj656yjjexsqa3zqm6ntkyjsjq',
    chainId: 'agoric-3',
    denom: 'ibc/CDEA201B61DF09C2456A91A60A87856796E6B40FAF41FC64E3482D4EF07DE26C'
  },
  {
    token: 'secret1wzqxaa6g6xa27vrwgygex8xurxdjzjtwzlgwy3',
    chainId: 'phoenix-1',
    denom: 'ibc/975B353EA188FAD4743D1C4BE63066F8E2C8CC7D29894102E64C5E8D3CE7B9D4',
    channel: 'channel-127'
  },
  {
    token: 'secret1lfqlcnpveh6at723h5k2nu4jjqeuz0ukpxxdtt',
    chainId: 'cheqd-mainnet-1',
    denom: 'ibc/0D5DA8508A67E30C3C268A0400EA15FAFB553C0C371757994C90BFA023FF0B93'
  },
  {
    token: 'secret1mndng80tqppllk0qclgcnvccf9urak08e9w2fl',
    chainId: 'comdex-1',
    denom: 'ibc/DFBDE185EC916F4933DF02D3A282FA801BC9EE77FE0B768FB517407730105491'
  },
  {
    token: 'secret14l7s0evqw7grxjlesn8yyuk5lexuvkwgpfdxr5',
    chainId: 'comdex-1',
    denom: 'ibc/B8CA0EBE2C9D8800390CE4256DF6C194CF6740CB0AEE140EEE60C1CE288CDB86'
  },
  {
    token: 'secret1e8p373krsxva4msh0gdh94lg3rhn7npgmd5g8v',
    chainId: 'coreum-mainnet-1',
    denom: 'ibc/3EA9790C386BD0FE422C9F9DB4BE162C130B9200D6D8245472F66E27AA82789C'
  },
  {
    token: 'secret1x3cxgrwymk7yyelf2782r8ay020xyl96zq3rhh',
    chainId: 'neutron-1',
    denom: 'ibc/E6B206CCAA9570BED0716B7FD4A6F9C6786249EABC24AFFD2B1A47A752C32159'
  },
  {
    token: 'secret1h5d3555tz37crrgl5rppu2np2fhaugq3q8yvv9',
    chainId: 'centauri-1',
    denom: 'ibc/78F0983CCA5E2A9E4950CBF4BECDAD16289D70B5A093BEE272A1FD05EC2E8E82'
  },
  {
    token: 'secret15qtw24mpmwkjessr46dnqruq4s4tstzf74jtkf',
    chainId: 'sentinelhub-2',
    denom: 'ibc/E83107E876FF194B54E9AC3099E49DBB7728156F250ABD3E997D2B7E89E0810B'
  },
  {
    token: 'secret13lndcagy53wfzh69rtv0dex3a7cks0dv5emwke',
    chainId: 'dydx-mainnet-1',
    denom: 'ibc/007F5EB5C29FF8BB23133B099B4A3D68326BD02B05E20590287746FAFF29E3CD'
  },
  {
    token: 'secret1vfe63g7ndhqq9qu8v4n97fj69rcmr5fy0dun75',
    chainId: 'dymension_1100-1',
    denom: 'ibc/6F3AC063885E799319E49C0F5D984C5DB1FC6542558225B87653023342DDD2CE'
  },
  {
    token: 'secret1r4cldegd4peufgtaxf0qpagclqspeqaf8dm0l9',
    chainId: 'neutron-1',
    denom: 'ibc/29E66548B3FE6F694001EE8902B40DD24D9FF2D538AAA8BB4C05E52C713B9C75'
  },
  {
    token: 'secret1agpgsn50xjdggzdzd6kl4jz5ueywtkuhnyyhx5',
    chainId: 'omniflixhub-1',
    denom: 'ibc/84AE15EF752A48A86611DB81809B0A5F00BE25159915F8DE5B0AFC25076002EC'
  },
  {
    token: 'secret1dtghxvrx35nznt8es3fwxrv4qh56tvxv22z79d',
    chainId: 'gravity-bridge-3',
    denom: 'ibc/DEEF987757F80419CC651C8323ACD21D6C3D664E51B5E5A29B2663F5AD132A67'
  },
  {
    token: 'secret1lrlkqhmwkh5y4326akn3hwn6j69f8l5656m43e',
    chainId: 'comdex-1',
    denom: 'ibc/33E509EAF84ED39E60F746CCAF89130B386A11FDD3B76A77377FB3946BC9D829'
  },
  {
    token: 'secret1ntvxnf5hzhzv8g87wn76ch6yswdujqlgmjh32w',
    chainId: 'chihuahua-1',
    denom: 'ibc/630E7B10690ADEC9E9CEEE904CE78C522BBCDDC6A081B23FA26A55F6EF40E41E'
  },
  {
    token: 'secret14706vxakdzkz9a36872cs62vpl5qd84kpwvpew',
    chainId: 'injective-1',
    denom: 'ibc/5A76568E079A31FA12165E4559BA9F1E9D4C97F9C2060B538C84DCD503815E30'
  },
  {
    token: 'secret1xmqsk8tnge0atzy4e079h0l2wrgz6splcq0a24',
    chainId: 'agoric-3',
    denom: 'ibc/5BE3E5E08E949BDF29EE93E81BF2CBD66347C86CE3D5D99A6E6FB487E62D8414'
  },
  {
    token: 'secret1sgaz455pmtgld6dequqayrdseq8vy2fc48n8y3',
    chainId: 'jackal-1',
    denom: 'ibc/B6E97E0FB88FF4660A677B27CE0CD03E5F74E0DE1B9D2B65F107249A3CE5C8FB'
  },
  {
    token: 'secret1z6e4skg5g9w65u5sqznrmagu05xq8u6zjcdg4a',
    chainId: 'juno-1',
    denom: 'ibc/DF8D00B4B31B55AFCA9BAF192BC36C67AA06D9987DCB96490661BCAB63C27006'
  },
  {
    token: 'secret1xyhphws090fqs33sxkytmagwynz54eqnpdqfrw',
    chainId: 'kava_2222-10',
    denom: 'ibc/6301A6E3731936DB3924F580AB96CEB72F97B21EFED083779984BE7322B7815A'
  },
  {
    token: 'secret13hvh0rn0rcf5zr486yxlrucvwpzwqu2dsz6zu8',
    chainId: 'kaiyo-1',
    denom: 'ibc/FFA324A40F82EF430CF78D498CE04FF634D2091FCDC04EFEC8841B86011F307A'
  },
  {
    token: 'secret1n4dp5dk6fufqmaalu9y7pnmk2r0hs7kc66a55f',
    chainId: 'centauri-1',
    denom: 'ibc/B776D45AA5F28ACD82F3E03D258B8386DA7D0622120991110849A6C40FEB911E'
  },
  {
    token: 'secret1yafpcu9wpauy5ktymggzk9kmsvmce0hkl9p2h7',
    chainId: 'pirin-1',
    denom: 'ibc/862D31E2B69C7E2C08AF52E564E05FFE7A55061337912E43F55198268598E2D9'
  },
  {
    token: 'secret16l5g98d45gqvvn2g79q23h8flfq65cvr9r6c72',
    chainId: 'kaiyo-1',
    denom: 'ibc/B9A62775A6281080F7C6B22D79F9B3B2863FF826C6BEDA5E7CF7CE2EDC656939'
  },
  {
    token: 'secret1k644rvd979wn4erjd5g42uehayjwrq094g5uvj',
    chainId: 'neutron-1',
    denom: 'ibc/F1E2912B7740A256EE98F87F464CC50EEB4511CEDFA9512365B2DA93057482DC'
  },
  {
    token: 'secret19gk280z6j9ywt3ln6fmfwfa36dkqeukcwqdw2k',
    chainId: 'nyx',
    denom: 'ibc/3D94B1D3EA1E52407BC69A78BC0A52D2440F0524F5268B899B67F18DEACB0B5F'
  },
  {
    token: 'secret149e7c5j7w24pljg6em6zj2p557fuyhg8cnk7z8',
    chainId: 'phoenix-1',
    denom: 'ibc/28DECFA7FB7E3AB58DC3B3AEA9B11C6C6B6E46356DCC26505205DAD3379984F5'
  },
  {
    token: 'secret1swrj0fqza3g98d7agm2nmukjfe44h7f5n8aavp',
    chainId: 'osmosis-1',
    denom: 'ibc/6A9571DE6A3F60D7703C3290E2944E806C15A47C1EA6D4AFCD3AE4DC8AF080B1'
  },
  {
    token: 'secret1h08ru5kul3yajg7tqj6vq9k6rccnfw2yqy8glc',
    chainId: 'osmosis-1',
    denom: 'ibc/C0DB3E0C7F3CD32FA24FC031FD8B6833627A1C690B741BA85D7A4752D974A77F'
  },
  {
    token: 'secret15rxfz2w2tallu9gr9zjxj8wav2lnz4gl9pjccj',
    chainId: 'kaiyo-1',
    denom: 'ibc/79F822764AF21756380877295C75F9FEB56BC0020612A7039931E27F30C01BE9'
  },
  {
    token: 'secret1sv0nxz6athw5qm0hsxl90376c9zhrxhhprhjph',
    chainId: 'Oraichain',
    denom: 'ibc/C35B578C6388E3061E7E88AF1F0C79074DEC6CF306F57156A2AFE60FB0903532'
  },
  {
    token: 'secret150jec8mc2hzyyqak4umv6cfevelr0x9p0mjxgg',
    chainId: 'osmosis-1',
    denom: 'ibc/0471F1C4E7AFD3F07702BEF6DC365268D64570F7C1FDC98EA6098DD6DE59817B'
  },
  {
    token: 'secret1hhvfxy44e4gp6k7n4e37t7uyqa54dnp68egugg',
    chainId: 'gravity-bridge-3',
    denom: 'ibc/F8C99EE495085DED2F11728CAEFE48CF144FEE7862DDBF57809B3DA24AA64E93'
  },
  {
    token: 'secret1e0y9vf4xr9wffyxsvlz35jzl5st2srkdl8frac',
    chainId: 'centauri-1',
    denom: 'ibc/7E8714E75B6A303CB074576F08D6FB3FB064C7E936F59AFE273CBB05DECE7151'
  },
  {
    token: 'secret1umeg3u5y949vz6jkgq0n4rhefsr84ws3duxmnz',
    chainId: 'core-1',
    denom: 'ibc/9774DCF1E103F4B7E23744AB4B38C18CACF96281FA9305167FC497BC2FC7B888'
  },
  {
    token: 'secret120cyurq25uvhkc7qjx7t28deuqslprxkc4rrzc',
    chainId: 'quicksilver-2',
    denom: 'ibc/97048A1FAFF5D84D4A5DDD9976AD332A3CAD99C81BC5C0C2B82A50E4C2131FB2'
  },
  {
    token: 'secret17d8c96kezszpda3r2c5dtkzlkfxw6mtu7q98ka',
    chainId: 'quicksilver-2',
    denom: 'ibc/C21A7C8801B94E73EBEDB9B0870D492190D7A01F63C8855962AAFDE2F026D8F6'
  },
  {
    token: 'secret1cj2fvj4ap79fl9euz8kqn0k5xlvck0pw9z9xhr',
    chainId: 'kaiyo-1',
    denom: 'ibc/C84076353ADA602528AC211EE626AE95FC4E091A0033B93CA5E1F6BE17070BBE'
  },
  {
    token: 'secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2',
    chainId: 'archway-1',
    denom: 'ibc/9162FF8AC138FFAB8723606E1FD726A95A2A153831ED6786396C374004AC28F8',
    needsSkip: true
  },
  {
    token: 'secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2',
    chainId: 'neutron-1',
    denom: 'ibc/9162FF8AC138FFAB8723606E1FD726A95A2A153831ED6786396C374004AC28F8',
    needsSkip: true
  },
  {
    token: 'secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2',
    chainId: 'noble-1',
    denom: 'ibc/9162FF8AC138FFAB8723606E1FD726A95A2A153831ED6786396C374004AC28F8'
  },
  {
    token: 'secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2',
    chainId: 'osmosis-1',
    denom: 'ibc/9162FF8AC138FFAB8723606E1FD726A95A2A153831ED6786396C374004AC28F8',
    needsSkip: true
  },
  {
    token: 'secret19gmvklys9uywk3lf2e94wqwwc97r3jr5rwa2pa',
    chainId: 'ssc-1',
    denom: 'ibc/5938378D6974EF73519C90789CBBFFFAEC43992A3D2B5E3F465F5DA96E434029'
  },
  {
    token: 'secret1x0dqckf2khtxyrjwhlkrx9lwwmz44k24vcv2vv',
    chainId: 'stargaze-1',
    denom: 'ibc/7EAE5BEF3A26B64AFBD89828AFDDB1DC7024A0276D22745201632C40E6E634D0'
  },
  {
    token: 'secret155w9uxruypsltvqfygh5urghd5v0zc6f9g69sq',
    chainId: 'osmosis-1',
    denom: 'ibc/A0E80E59956C754F1D9CB37234D13E0CF2949E7254896359F284512FA8428E18',
    needsSkip: true
  },
  {
    token: 'secret155w9uxruypsltvqfygh5urghd5v0zc6f9g69sq',
    chainId: 'stride-1',
    denom: 'ibc/A0E80E59956C754F1D9CB37234D13E0CF2949E7254896359F284512FA8428E18'
  },
  {
    token: 'secret1eurddal3m0tphtapad9awgzcuxwz8ptrdx7h4n',
    chainId: 'osmosis-1',
    denom: 'ibc/7E8DC1B7D29E1FD88496D49CA8045F98EDF5C4D332D64D058BFB7DFCAACE8F46',
    needsSkip: true
  },
  {
    token: 'secret1eurddal3m0tphtapad9awgzcuxwz8ptrdx7h4n',
    chainId: 'stride-1',
    denom: 'ibc/7E8DC1B7D29E1FD88496D49CA8045F98EDF5C4D332D64D058BFB7DFCAACE8F46'
  },
  {
    token: 'secret1097nagcaavlkchl87xkqptww2qkwuvhdnsqs2v',
    chainId: 'osmosis-1',
    denom: 'ibc/9B7F6219D699F608B23382F341E29303D66D5CA81F91D6D0B957119F97569F0F',
    needsSkip: true
  },
  {
    token: 'secret1097nagcaavlkchl87xkqptww2qkwuvhdnsqs2v',
    chainId: 'stride-1',
    denom: 'ibc/9B7F6219D699F608B23382F341E29303D66D5CA81F91D6D0B957119F97569F0F'
  },
  {
    token: 'secret16vjfe24un4z7d3sp9vd0cmmfmz397nh2njpw3e',
    chainId: 'core-1',
    denom: 'ibc/DEA3620A6407C63A287A4FE1683D07627F27AF7A83E077B1E51EDFF8833980FE'
  },
  {
    token: 'secret16dctnuy6lwydw834f4d0t3sw3f6jhav6ryhe4m',
    chainId: 'core-1',
    denom: 'ibc/770CF5C334866B8760435B1670C3CEEE3A42B4E6C85CB5A71E23F1610B62DB70'
  },
  {
    token: 'secret1rkgvpck36v2splc203sswdr0fxhyjcng7099a9',
    chainId: 'osmosis-1',
    denom: 'ibc/C8D8F46E3CE6F41E01E32542215597CF4B32709C8A310F728653CB91FDB8A904',
    needsSkip: true
  },
  {
    token: 'secret1rkgvpck36v2splc203sswdr0fxhyjcng7099a9',
    chainId: 'stride-1',
    denom: 'ibc/C8D8F46E3CE6F41E01E32542215597CF4B32709C8A310F728653CB91FDB8A904'
  },
  {
    token: 'secret1jrp6z8v679yaq65rndsr970mhaxzgfkymvc58g',
    chainId: 'osmosis-1',
    denom: 'ibc/B0988C39E7418C644FDFD41682A59D22DCAD1BCC7A6429B2EAAA195FB726A2D7',
    needsSkip: true
  },
  {
    token: 'secret1jrp6z8v679yaq65rndsr970mhaxzgfkymvc58g',
    chainId: 'stride-1',
    denom: 'ibc/B0988C39E7418C644FDFD41682A59D22DCAD1BCC7A6429B2EAAA195FB726A2D7'
  },
  {
    token: 'secret1rfhgs3ryqt7makakr2qw9zsqq4h5wdqawfa2aa',
    chainId: 'osmosis-1',
    denom: 'ibc/CE591002C567BE4B8C4EC3F3F3D18AF7A1CA9FADBF5876C8413F8B2BD83CE8FF',
    needsSkip: true
  },
  {
    token: 'secret1rfhgs3ryqt7makakr2qw9zsqq4h5wdqawfa2aa',
    chainId: 'stride-1',
    denom: 'ibc/CE591002C567BE4B8C4EC3F3F3D18AF7A1CA9FADBF5876C8413F8B2BD83CE8FF'
  },
  {
    token: 'secret1l5d0vncwnlln0tz0m4tp9rgm740xl7th6es0q0',
    chainId: 'osmosis-1',
    denom: 'ibc/B0988C39E7418C644FDFD41682A59D22DCAD1BCC7A6429B2EAAA195FB726A2D7',
    needsSkip: true
  },
  {
    token: 'secret1l5d0vncwnlln0tz0m4tp9rgm740xl7th6es0q0',
    chainId: 'stride-1',
    denom: 'ibc/A223651B9E968C94D2C8378DDFAAF619CD215925BB793763A6CD626C7E36ED0C'
  },
  {
    token: 'secret1gech42jfcdke92tf9ltscpq7x0al8j7gkce030',
    chainId: 'carbon-1',
    denom: 'ibc/9AD48A1B686F2B6470FCDF6363130842CC96D51F055D3D424F83B936D2A2BBEB'
  },
  {
    token: 'secret1hjcv25hpgqtpwn90tz7pttr9fyz7l9pngzz8rl',
    chainId: 'injective-1',
    denom: 'ibc/F304520D97EBC7FE3BC4404AF2A1338CC9075DA853BCDF30D65662BED5EAEEF5'
  },
  {
    token: 'secret1s9h6mrp4k9gll4zfv5h78ll68hdq8ml7jrnn20',
    chainId: 'celestia',
    denom: 'ibc/8E31B43C53FA68AFEB6A0A4A61DA67F357A6BD757F745A3CB65B97CD9D9DA1BB'
  },
  {
    token: 'secret1s9h6mrp4k9gll4zfv5h78ll68hdq8ml7jrnn20',
    chainId: 'osmosis-1',
    denom: 'ibc/8E31B43C53FA68AFEB6A0A4A61DA67F357A6BD757F745A3CB65B97CD9D9DA1BB',
    needsSkip: true
  },
  {
    token: 'secret1f6yg0typy608r567xekwyn3qf0k902llue9w2l',
    chainId: 'umee-1',
    denom: 'ibc/1B5D8D2E9B85030391AE48EB992A0466F8DE5DB8F15E745CF25D5714142391BD'
  },
  {
    token: 'secret1htd6s29m2j9h45knwkyucz98m306n32hx8dww3',
    chainId: 'kava_2222-10',
    denom: 'ibc/0B1830E544F39B2CDD1CE415D1B1A377039E495CE83055C01BF6AE4518C28755'
  },
  {
    token: 'secret1v2kgmfwgd2an0l5ddralajg5wfdkemxl2vg4jp',
    chainId: 'osmosis-1',
    denom: 'ibc/CF57A83CED6CEC7D706631B5DC53ABC21B7EDA7DF7490732B4361E6D5DD19C73'
  },
  {
    token: 'secret1pcftk3ny87zm6thuxyfrtrlm2t8yev5unuvx6c',
    chainId: 'migaloo-1',
    denom: 'ibc/1D5E074747E7E5B67DE2CDD360FD5581640591FAEDB7EEFFF9E4CA5AAE3FEF9E'
  },
  {
    token: 'secret1xx6m5c7d92h75evkmxqqe2xe5sk5qcqqs9t8ar',
    chainId: 'neutron-1',
    denom: 'ibc/9AD9D38BE249CB6F0A22A1EB5487E2377B79FADB397444B1F77F29B96F34C2F1'
  },
  {
    token: 'secret1gnrrqjj5e2pwn4g262xjyypptu0ge3z3tps3nn',
    chainId: 'core-1',
    denom: 'ibc/3587AC36A81A13FCFB1D0EC03CEB98AEAAAB1F5275B68C7DC2B40BA6279AA696'
  },
  {
    token: 'secret1gqn3k7792h9vqpydvq6hnh3wr9lqg3s9j6hzy6',
    chainId: 'coreum-mainnet-1',
    denom: 'ibc/178811A87188241F39138EB06BFE7B09BAE5A65E80A48B42F1DB23542C793D1E'
  },
  {
    token: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    chainId: 'archway-1',
    denom: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    chainId: 'osmosis-1',
    denom: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    chainId: 'kaiyo-1',
    denom: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    chainId: 'juno-1',
    denom: 'secret17ljp7wwesff85ewt8xlauxjt7zrlr2hh27wgvr',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'archway-1',
    denom: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'centauri-1',
    denom: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    channel: 'channel-83',
    gas: 350000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'osmosis-1',
    denom: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'kaiyo-1',
    denom: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'juno-1',
    denom: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'migaloo-1',
    denom: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    channel: 'channel-129',
    gas: 350000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'neutron-1',
    denom: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    channel: 'channel-151',
    gas: 350000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'Oraichain',
    denom: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    channel: 'channel-140',
    gas: 350000
  },
  {
    token: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    chainId: 'core-1',
    denom: 'secret1gddp7wlpkups509u76dca550xuxk6ckjru5x54',
    channel: 'channel-132',
    gas: 350000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'archway-1',
    denom: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'centauri-1',
    denom: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    channel: 'channel-83',
    gas: 350000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'osmosis-1',
    denom: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'kaiyo-1',
    denom: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'juno-1',
    denom: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'migaloo-1',
    denom: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    channel: 'channel-129',
    gas: 350000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'neutron-1',
    denom: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    channel: 'channel-151',
    gas: 350000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'Oraichain',
    denom: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    channel: 'channel-140',
    gas: 350000
  },
  {
    token: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    chainId: 'core-1',
    denom: 'secret1kmjr03phgn4v4u0altvvuc53lfmy033wmvddy5',
    channel: 'channel-132',
    gas: 350000
  },
  {
    token: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
    chainId: 'osmosis-1',
    denom: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
    chainId: 'kaiyo-1',
    denom: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
    chainId: 'juno-1',
    denom: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'archway-1',
    denom: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'centauri-1',
    denom: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    channel: 'channel-83',
    gas: 350000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'osmosis-1',
    denom: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'kaiyo-1',
    denom: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'juno-1',
    denom: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'migaloo-1',
    denom: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    channel: 'channel-129',
    gas: 350000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'neutron-1',
    denom: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    channel: 'channel-151',
    gas: 350000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'Oraichain',
    denom: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    channel: 'channel-140',
    gas: 350000
  },
  {
    token: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    chainId: 'core-1',
    denom: 'secret1fcef2mpuzw7py0e6eplrm06t5n6n2xfljvuzaq',
    channel: 'channel-132',
    gas: 350000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'archway-1',
    denom: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'centauri-1',
    denom: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    channel: 'channel-83',
    gas: 350000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'osmosis-1',
    denom: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'kaiyo-1',
    denom: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'juno-1',
    denom: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'migaloo-1',
    denom: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    channel: 'channel-129',
    gas: 350000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'neutron-1',
    denom: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    channel: 'channel-151',
    gas: 350000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'Oraichain',
    denom: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    channel: 'channel-140',
    gas: 350000
  },
  {
    token: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    chainId: 'core-1',
    denom: 'secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve',
    channel: 'channel-132',
    gas: 350000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'archway-1',
    denom: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'centauri-1',
    denom: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    channel: 'channel-83',
    gas: 350000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'osmosis-1',
    denom: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'kaiyo-1',
    denom: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'juno-1',
    denom: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'migaloo-1',
    denom: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    channel: 'channel-129',
    gas: 350000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'neutron-1',
    denom: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    channel: 'channel-151',
    gas: 350000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'Oraichain',
    denom: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    channel: 'channel-140',
    gas: 350000
  },
  {
    token: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    chainId: 'core-1',
    denom: 'secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm',
    channel: 'channel-132',
    gas: 350000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'archway-1',
    denom: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'centauri-1',
    denom: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    channel: 'channel-83',
    gas: 350000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'osmosis-1',
    denom: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'kaiyo-1',
    denom: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'juno-1',
    denom: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'migaloo-1',
    denom: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    channel: 'channel-129',
    gas: 350000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'neutron-1',
    denom: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    channel: 'channel-151',
    gas: 350000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'Oraichain',
    denom: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    channel: 'channel-140',
    gas: 350000
  },
  {
    token: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    chainId: 'core-1',
    denom: 'secret197dvnt9yjxwn8sjdlx05f7zuk27lsdxtfnwxse',
    channel: 'channel-132',
    gas: 350000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'archway-1',
    denom: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'centauri-1',
    denom: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    channel: 'channel-83',
    gas: 350000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'osmosis-1',
    denom: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'kaiyo-1',
    denom: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'juno-1',
    denom: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'migaloo-1',
    denom: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    channel: 'channel-129',
    gas: 350000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'neutron-1',
    denom: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    channel: 'channel-151',
    gas: 350000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'Oraichain',
    denom: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    channel: 'channel-140',
    gas: 350000
  },
  {
    token: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    chainId: 'core-1',
    denom: 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd',
    channel: 'channel-132',
    gas: 350000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'archway-1',
    denom: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'centauri-1',
    denom: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    channel: 'channel-83',
    gas: 350000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'osmosis-1',
    denom: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'kaiyo-1',
    denom: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'juno-1',
    denom: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'migaloo-1',
    denom: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    channel: 'channel-129',
    gas: 350000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'neutron-1',
    denom: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    channel: 'channel-151',
    gas: 350000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'Oraichain',
    denom: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    channel: 'channel-140',
    gas: 350000
  },
  {
    token: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    chainId: 'core-1',
    denom: 'secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4',
    channel: 'channel-132',
    gas: 350000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'archway-1',
    denom: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'centauri-1',
    denom: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    channel: 'channel-83',
    gas: 350000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'osmosis-1',
    denom: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'kaiyo-1',
    denom: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'juno-1',
    denom: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'migaloo-1',
    denom: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    channel: 'channel-129',
    gas: 350000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'neutron-1',
    denom: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    channel: 'channel-151',
    gas: 350000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'Oraichain',
    denom: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    channel: 'channel-140',
    gas: 350000
  },
  {
    token: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    chainId: 'core-1',
    denom: 'secret1ydpmlhqat9s2qxwc5ldyms8yp53nhqcvh6mz3c',
    channel: 'channel-132',
    gas: 350000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'archway-1',
    denom: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    channel: 'channel-90',
    gas: 350000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'centauri-1',
    denom: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    channel: 'channel-83',
    gas: 350000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'osmosis-1',
    denom: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    channel: 'channel-44',
    gas: 350000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'kaiyo-1',
    denom: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    channel: 'channel-46',
    gas: 350000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'juno-1',
    denom: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    channel: 'channel-45',
    gas: 350000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'migaloo-1',
    denom: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    channel: 'channel-129',
    gas: 350000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'neutron-1',
    denom: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    channel: 'channel-151',
    gas: 350000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'Oraichain',
    denom: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    channel: 'channel-140',
    gas: 350000
  },
  {
    token: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    chainId: 'core-1',
    denom: 'secret179m85kh3vq6cler57na6c6m5d3lwm3zj0m2v9u',
    channel: 'channel-132',
    gas: 350000
  }
]

function index(routes: Route[]): Map<string, Route[]> {
  const byToken = new Map<string, Route[]>()
  for (const route of routes) {
    const list = byToken.get(route.token)
    if (list) list.push(route)
    else byToken.set(route.token, [route])
  }
  return byToken
}

const DEPOSITS_BY_TOKEN = index(DEPOSIT_ROUTES)
const WITHDRAWALS_BY_TOKEN = index(WITHDRAW_ROUTES)

/** Chains this token can be bridged in from. Single-hop routes only. */
export function depositRoutes(token: string): Route[] {
  return (DEPOSITS_BY_TOKEN.get(token) ?? []).filter((route) => !route.needsSkip)
}

export function withdrawRoutes(token: string): Route[] {
  return (WITHDRAWALS_BY_TOKEN.get(token) ?? []).filter((route) => !route.needsSkip)
}

export function depositRoute(token: string, chainId: string): Route | undefined {
  return depositRoutes(token).find((route) => route.chainId === chainId)
}

/** Every token that can be bridged in from this chain. */
export function tokensFromChain(chainId: string): string[] {
  return [...new Set(DEPOSIT_ROUTES.filter((r) => r.chainId === chainId && !r.needsSkip).map((r) => r.token))]
}

/** Every chain any token can be bridged in from. */
export function chainsWithDeposits(): string[] {
  return [...new Set(DEPOSIT_ROUTES.filter((r) => !r.needsSkip).map((r) => r.chainId))]
}

export function withdrawRoute(token: string, chainId: string): Route | undefined {
  return withdrawRoutes(token).find((route) => route.chainId === chainId)
}

/** Every token that can be bridged out to this chain. */
export function tokensToChain(chainId: string): string[] {
  return [
    ...new Set(WITHDRAW_ROUTES.filter((r) => r.chainId === chainId && !r.needsSkip).map((r) => r.token))
  ]
}

/** Every chain any token can be bridged out to. */
export function chainsWithWithdrawals(): string[] {
  return [...new Set(WITHDRAW_ROUTES.filter((r) => !r.needsSkip).map((r) => r.chainId))]
}

/**
 * The denomination a SNIP-20's underlying asset wears on Secret's bank module —
 * `uscrt` for sSCRT, an `ibc/…` voucher for anything bridged in.
 *
 * This is what a wrap spends and an unwrap returns, and it is read out of the
 * withdraw table rather than stored twice: that table already has to name it,
 * and a second copy is a second thing to get wrong.
 *
 * `undefined` when the token has no single-hop route, or when the routes it
 * does have disagree: a token that arrived over two channels wears two
 * different vouchers, and those are two different assets. Guessing between them
 * would wrap the wrong one. As the table stands every registry token with a
 * route resolves to one denomination, but that is a fact about today's table
 * and not something to rely on.
 *
 * Also `undefined` when the route names something that is not a bank
 * denomination at all. Secret-native tokens — SHD, SILK, AMBER — leave over a
 * contract of their own rather than the transfer module, so their withdraw
 * routes carry a `secret1…` contract address in this field. That address names
 * nothing in the bank module, and treating it as a denomination produces a wrap
 * that spends a coin which cannot exist. Only `uscrt` and `ibc/…` are Secret
 * bank denominations; nothing else is accepted here.
 */
export function bankDenomFor(token: string): string | undefined {
  const denoms = new Set(withdrawRoutes(token).map((route) => route.denom))
  if (denoms.size !== 1) return undefined
  const denom = [...denoms][0]
  return denom === DENOM || denom.startsWith('ibc/') ? denom : undefined
}

/**
 * The reverse: which SNIP-20 a bank denomination wraps into.
 *
 * Built by inverting `bankDenomFor` rather than by a second table, so the two
 * directions cannot drift apart. A denomination claimed by more than one token
 * is dropped rather than resolved arbitrarily — wrapping into the wrong
 * contract is not a mistake that shows up until the balance is gone. (As the
 * table stands there are none; this is a guard, not a workaround.)
 */
let byBankDenom: Map<string, string> | undefined

export function tokenAddressForBankDenom(denom: string): string | undefined {
  if (!byBankDenom) {
    const claims = new Map<string, string[]>()
    for (const token of new Set([...DEPOSIT_ROUTES, ...WITHDRAW_ROUTES].map((route) => route.token))) {
      const bank = bankDenomFor(token)
      if (!bank) continue
      claims.set(bank, [...(claims.get(bank) ?? []), token])
    }
    byBankDenom = new Map(
      [...claims].filter(([, tokens]) => tokens.length === 1).map(([bank, tokens]) => [bank, tokens[0]])
    )
  }
  return byBankDenom.get(denom)
}
