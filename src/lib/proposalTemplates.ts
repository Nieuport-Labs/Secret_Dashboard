import { DENOM } from '@/chains/secret4'
import { GOV_AUTHORITY } from '@/lib/proposalMessages'

/**
 * Starting points for the messages a proposal executes.
 *
 * Not a form per message type, and not meant to be: the JSON stays the thing
 * being written, and these only save the author looking up the field names.
 * Each one is a shape that has to be edited before it means anything — a
 * recipient to fill in, a figure to change — so none of them can be signed by
 * accident.
 *
 * Kept to the three proposals people actually write here. Anything else is
 * still hand-written JSON, which is the whole reason the editor takes JSON.
 */
export interface ProposalTemplate {
  id: string
  label: string
  /** One line on when this is the right message. */
  detail: string
  /** Built from the chain's own parameters where that matters. */
  json: (params?: Record<string, unknown>) => string
}

const pretty = (value: unknown) => JSON.stringify([value], null, 2)

export const PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  {
    id: 'community-pool-spend',
    label: 'Treasury funding',
    detail: 'Pays an amount out of the community pool to an account.',
    json: () =>
      pretty({
        '@type': '/cosmos.distribution.v1beta1.MsgCommunityPoolSpend',
        authority: GOV_AUTHORITY,
        recipient: 'secret1…',
        // A round 1 SCRT, in base units: small enough that nobody sends it by
        // mistake, and it shows where the six decimal places go.
        amount: [{ denom: DENOM, amount: '1000000' }]
      })
  },
  {
    id: 'gov-params',
    label: 'Governance parameters',
    detail: 'Changes a governance parameter. Carries the current set; edit the line you mean.',
    json: (params) =>
      pretty({
        '@type': '/cosmos.gov.v1.MsgUpdateParams',
        authority: GOV_AUTHORITY,
        /*
         * The live parameters, verbatim. This message replaces the whole struct
         * rather than merging, so every field has to be present — which makes
         * a template that is literally the current state the only sound one.
         */
        params: params ?? {
          min_deposit: [{ denom: DENOM, amount: '1000000000' }],
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
          expedited_min_deposit: [{ denom: DENOM, amount: '2500000000' }],
          burn_vote_quorum: false,
          burn_proposal_deposit_prevote: false,
          burn_vote_veto: true,
          min_deposit_ratio: '0.010000000000000000'
        }
      })
  },
  {
    id: 'software-upgrade',
    label: 'Software upgrade',
    detail: 'Halts the chain at a height for validators to upgrade.',
    json: () =>
      pretty({
        '@type': '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade',
        authority: GOV_AUTHORITY,
        plan: {
          name: 'v1.19',
          height: '0',
          info: ''
        }
      })
  }
]
