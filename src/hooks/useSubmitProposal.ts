import { useCallback, useState } from 'react'

import { DENOM, GAS, GAS_PRICE_USCRT } from '@/chains/secret4'
import { errorMessage } from '@/lib/errors'
import { sendTx } from '@/lib/sendTx'
import { submitProposalMessage, submittedProposalId, type ProposalDraft } from '@/lib/governance'
import { MSG_SUBMIT_PROPOSAL } from '@/lib/msgTypes'
import { useWallet } from '@/store/wallet'
import type { ActionState } from '@/hooks/useStakingActions'

/**
 * A rehearsal of the transaction against a node, before any of it is paid for.
 *
 * Worth a step of its own here in a way it is not for a vote: a proposal
 * carries messages the author wrote, and the chain has rules about them that
 * nothing on the client can check — that the authority is the gov account, that
 * a recipient exists, that an upgrade height is still ahead. All of those
 * surface as a rejected transaction whose fee is already spent.
 */
export type DryRun =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; gasUsed: number }
  | { kind: 'failed'; message: string }

/**
 * Submitting a governance proposal.
 *
 * The proposer is the connected wallet, not the validator a session may be
 * acting for: a proposal's deposit comes out of the proposer's own balance, and
 * spending a validator's funds is not something the vote-level authority in
 * this app is a licence for. The fee still goes through the app's fee payer
 * like every other transaction — the deposit never does.
 */
export function useSubmitProposal() {
  const client = useWallet((state) => state.client)
  const address = useWallet((state) => state.address)

  const [state, setState] = useState<ActionState>({ kind: 'idle' })
  const [dryRun, setDryRun] = useState<DryRun>({ kind: 'idle' })
  /** The number the chain gave it, once it has one. */
  const [proposalId, setProposalId] = useState<string | undefined>()

  const reset = useCallback(() => {
    setState({ kind: 'idle' })
    setDryRun({ kind: 'idle' })
    setProposalId(undefined)
  }, [])

  /**
   * Gas for the real thing.
   *
   * A rehearsed proposal is sized from what it actually used, with room on top
   * for the state a simulation does not write; an unrehearsed one falls back to
   * the fixed limit. Never below that limit: simulation undercounts, and the
   * fee estimate handed to the grant selector has to be at least what is paid.
   */
  const gasFor = useCallback(
    () =>
      dryRun.kind === 'ok'
        ? Math.max(GAS.submitProposal, Math.ceil(dryRun.gasUsed * 1.4))
        : GAS.submitProposal,
    [dryRun]
  )

  const check = useCallback(
    async (draft: ProposalDraft) => {
      if (!client || !address) return
      setDryRun({ kind: 'running' })
      try {
        const message = await submitProposalMessage(draft, address)
        const simulated = await client.tx.simulate([message], {
          gasLimit: GAS.submitProposal,
          gasPriceInFeeDenom: GAS_PRICE_USCRT,
          feeDenom: DENOM
        })
        setDryRun({ kind: 'ok', gasUsed: Number(simulated.gas_info?.gas_used ?? 0) })
      } catch (error) {
        setDryRun({ kind: 'failed', message: errorMessage(error) })
      }
    },
    [client, address]
  )

  const submit = useCallback(
    async (draft: ProposalDraft) => {
      if (!client || !address) return

      setState({ kind: 'sending' })
      try {
        const message = await submitProposalMessage(draft, address)
        const gas = gasFor()

        const tx = await sendTx(client, [message], gas, [MSG_SUBMIT_PROPOSAL])

        if (tx.code !== 0) {
          setState({
            kind: 'failed',
            message: tx.rawLog || `The chain rejected it (code ${tx.code}).`
          })
          return
        }

        setProposalId(submittedProposalId(tx.arrayLog))
        setState({ kind: 'done', hash: tx.transactionHash })
      } catch (error) {
        setState({ kind: 'failed', message: errorMessage(error) })
      }
    },
    [client, address, gasFor]
  )

  return {
    state,
    dryRun,
    proposalId,
    check,
    submit,
    reset,
    /** The gas this submission would be sent with, for the fee line in the form. */
    gas: gasFor(),
    proposer: address
  }
}
