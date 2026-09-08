import { Server } from 'lucide-react'
import { useEffect, useState } from 'react'

import EmptyState from '@/components/ui/EmptyState'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { useValidatorAccount } from '@/hooks/useValidatorAccount'
import { formatDisplayAmount } from '@/lib/format'
import { queryValidators } from '@/lib/staking'
import ValidatorIdentity from '@/pages/validator/components/ValidatorIdentity'
import { useActiveValidator } from '@/store/accounts'
import { useWallet } from '@/store/wallet'

/**
 * How this validator is doing: its signing record and where it sits in the set.
 *
 * Governance lives on its own screen, which in validator mode already shows the
 * validator's votes rather than the wallet's — repeating a slice of it here
 * would be a second place to keep correct for no new information.
 */
export default function ValidatorStats() {
  const active = useActiveValidator()
  const valoper = active?.account.valoper
  const client = useWallet((state) => state.queryClient)
  const data = useValidatorAccount(valoper)

  const [rank, setRank] = useState<number | undefined>()
  const [setSize, setSetSize] = useState<number | undefined>()

  useEffect(() => {
    if (!client || !valoper) return
    let cancelled = false

    void queryValidators(client)
      .then((validators) => {
        if (cancelled) return
        const index = validators.findIndex((v) => v.address === valoper)
        setRank(index === -1 ? undefined : index + 1)
        setSetSize(validators.length)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [client, valoper])

  if (!active) return null

  if (data.error) {
    return <EmptyState icon={Server} title="Could not read this validator" description={data.error} />
  }
  if (!data.detail) {
    return <p className="text-base text-text-muted">Loading stats…</p>
  }

  const signing = data.signing
  // Uptime over the window the chain judges downtime on, which is the only
  // window it keeps a counter for — not lifetime uptime.
  const uptime =
    signing && signing.signedBlocksWindow > 0
      ? 1 - signing.missedBlocks / signing.signedBlocksWindow
      : undefined

  // Scaled by a billion before dividing, not by ten thousand: self-bond against
  // a large validator is routinely a millionth of its stake, and a coarser
  // scale truncates every one of those to a flat zero.
  const selfBondRatio =
    BigInt(data.detail.tokens) > 0n
      ? Number((BigInt(data.selfDelegation) * 1_000_000_000n) / BigInt(data.detail.tokens)) / 1_000_000_000
      : undefined

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-8">
      <ValidatorIdentity detail={data.detail} canOperate={active.canOperate} />

      <section className="flex flex-col gap-3">
        <h2 className="text-title">Signing</h2>
        <div className="card grid divide-y divide-border overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Stat
            label="Uptime"
            value={uptime === undefined ? 'Unavailable' : `${(uptime * 100).toFixed(2)}%`}
            note={
              signing
                ? `${signing.missedBlocks.toLocaleString()} missed of ${signing.signedBlocksWindow.toLocaleString()}`
                : 'signing record could not be read'
            }
          />
          <Stat
            label="Jail status"
            value={data.detail.jailed ? 'Jailed' : signing?.tombstoned ? 'Tombstoned' : 'Clear'}
            note={
              signing?.jailedUntil && signing.jailedUntil > new Date()
                ? `until ${signing.jailedUntil.toLocaleString()}`
                : undefined
            }
          />
          <Stat
            label="Self-bond"
            value={selfBondRatio === undefined ? 'Unavailable' : percent(selfBondRatio)}
            note={`${formatDisplayAmount(data.selfDelegation)} ${DISPLAY_DENOM} of own stake`}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title">Position</h2>
        <div className="card grid divide-y divide-border overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Stat
            label="Rank"
            value={rank === undefined ? 'Outside the set' : `#${rank}`}
            note={setSize ? `of ${setSize} bonded validators` : undefined}
          />
          <Stat label="Voting power" value={`${formatDisplayAmount(data.detail.tokens)} ${DISPLAY_DENOM}`} />
          <Stat
            label="Delegators"
            value={data.delegators === undefined ? 'Unavailable' : data.delegators.toLocaleString()}
          />
        </div>
      </section>

    </div>
  )
}

/**
 * A share, floored rather than rounded to nothing.
 *
 * Self-bond against a large validator is routinely a few thousandths of a
 * percent, and "0.00%" there reads as a figure that failed to load rather than
 * a small one.
 */
function percent(value: number): string {
  if (value > 0 && value < 0.0001) return '<0.01%'
  return `${(value * 100).toFixed(2)}%`
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="p-5">
      <p className="text-label text-text-muted">{label}</p>
      <p className="mt-1.5 text-headline tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-label text-text-faint">{note}</p> : null}
    </div>
  )
}
