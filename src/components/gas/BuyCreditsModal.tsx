import { ExternalLink, Fuel } from 'lucide-react'
import { useEffect, useState } from 'react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { DISPLAY_DENOM, GAS, GAS_VAULT_ADDRESS, explorerTxUrl } from '@/chains/secret4'
import { formatAmount, toBaseUnits } from '@/lib/format'
import { buyGasCredit, queryVaultStatus } from '@/lib/gasVault'
import { MSG_EXECUTE_CONTRACT } from '@/lib/msgTypes'
import { transactionsCovered, useFeePayer } from '@/store/feePayer'
import { useWallet } from '@/store/wallet'

interface Props {
  open: boolean
  onClose: () => void
}

const PRESETS = ['0.5', '1', '5']

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; hash: string }
  | { kind: 'failed'; message: string }

/**
 * Buy gas credits from the vault contract.
 *
 * Paying SCRT in makes the contract issue this address a fee allowance of the
 * same size, payable from the contract rather than from the buyer's balance.
 * The point is that the allowance survives the buyer spending everything else.
 */
export default function BuyCreditsModal({ open, onClose }: Props) {
  const address = useWallet((state) => state.address)
  const client = useWallet((state) => state.client)
  const queryClient = useWallet((state) => state.queryClient)
  const granterFor = useFeePayer((state) => state.granterFor)
  const refreshGrants = useFeePayer((state) => state.refresh)

  const [amount, setAmount] = useState('1')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [vaultBalance, setVaultBalance] = useState<string | undefined>()

  // What the vault holds is also the sum of every allowance it has issued and
  // not seen spent, so this single figure says whether its grants are backed.
  useEffect(() => {
    if (!open || !queryClient) return
    let cancelled = false
    void queryVaultStatus(queryClient, GAS_VAULT_ADDRESS)
      .then((s) => {
        if (!cancelled) setVaultBalance(s.balance)
      })
      .catch(() => {
        if (!cancelled) setVaultBalance(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [open, queryClient])

  let baseUnits: string | undefined
  let amountError: string | undefined
  try {
    baseUnits = toBaseUnits(amount)
    if (BigInt(baseUnits) === 0n) amountError = 'Enter an amount above zero.'
  } catch (error) {
    amountError = error instanceof Error ? error.message : 'Not a number.'
  }

  const buy = async () => {
    if (!client || !address || !baseUnits) return
    setStatus({ kind: 'sending' })
    try {
      const tx = await buyGasCredit(
        client,
        GAS_VAULT_ADDRESS,
        address,
        // Buying for yourself. The contract accepts any grantee, which is what
        // lets someone else be sponsored, but that is not this screen's job.
        address,
        amount,
        granterFor(GAS.buyGasCredit, [MSG_EXECUTE_CONTRACT])
      )

      if (tx.code !== 0) {
        setStatus({ kind: 'failed', message: tx.rawLog || `The chain rejected it (code ${tx.code}).` })
        return
      }

      setStatus({ kind: 'done', hash: tx.transactionHash })
      await refreshGrants()
    } catch (error) {
      setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const covered = baseUnits ? transactionsCovered(BigInt(baseUnits)) : 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buy gas credits"
      description="Pay SCRT in and the vault contract covers your transaction fees, from its balance rather than yours."
    >
      {status.kind === 'done' ? (
        <div className="flex flex-col gap-4">
          <p className="text-base">
            Bought {amount} {DISPLAY_DENOM} of credit. It applies to your next transaction automatically while
            your fee setting is Auto.
          </p>
          <a
            className="inline-flex items-center gap-1.5 text-base text-accent underline underline-offset-4"
            href={explorerTxUrl(status.hash)}
            target="_blank"
            rel="noreferrer noopener"
          >
            View transaction
            <ExternalLink size={14} aria-hidden />
          </a>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="credit-amount" className="text-base font-medium">
              Amount
            </label>
            <div className="flex items-center gap-2 rounded-control bg-surface px-4 py-3">
              <input
                id="credit-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
                placeholder="0.0"
              />
              <span className="shrink-0 text-base text-text-muted">{DISPLAY_DENOM}</span>
            </div>
            <div className="flex gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset}
                  variant="soft"
                  shape="control"
                  size="sm"
                  onClick={() => setAmount(preset)}
                >
                  {preset}
                </Button>
              ))}
            </div>
            {amountError ? (
              <p className="text-base text-negative" role="alert">
                {amountError}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-base text-text-muted">
                <Fuel size={16} aria-hidden />
                Roughly {covered} transactions
              </p>
            )}
          </div>

          <dl className="flex flex-col gap-1 text-base">
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Vault balance</dt>
              <dd>
                {vaultBalance === undefined
                  ? 'Unavailable'
                  : `${formatAmount(vaultBalance)} ${DISPLAY_DENOM}`}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Network fee for this purchase</dt>
              <dd>paid separately</dd>
            </div>
          </dl>

          {/* Both of these are ways people lose track of what a grant does. */}
          <p className="text-sm text-text-faint">
            Credits pay fees only. They are not a token, cannot be sent on, and a private SNIP-20 token cannot
            pay gas on this chain in the first place.
          </p>

          {status.kind === 'failed' ? (
            <p className="break-address text-base text-negative" role="alert">
              {status.message}
            </p>
          ) : null}

          <Button
            variant="primary"
            block
            loading={status.kind === 'sending'}
            disabled={!client || Boolean(amountError)}
            onClick={() => void buy()}
          >
            {client ? 'Buy credits' : 'Connect a wallet first'}
          </Button>
        </div>
      )}
    </Modal>
  )
}
