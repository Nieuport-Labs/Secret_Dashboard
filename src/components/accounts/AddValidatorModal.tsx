import { Check, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { errorMessage } from '@/lib/errors'
import { shortenAddress } from '@/lib/format'
import { queryValidator, queryValidators, type Validator } from '@/lib/staking'
import { toValoper } from '@/lib/validator'
import ValidatorAvatar from '@/pages/staking/components/ValidatorAvatar'
import { useAccounts } from '@/store/accounts'
import { useWallet } from '@/store/wallet'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Adding a validator, the two ways someone actually arrives at one.
 *
 * If the connected wallet *is* a validator's operator, that is worth saying
 * before asking anyone to search for their own name — the account address and
 * the validator address are the same key, so the check costs one query and
 * turns the common case into a single click. Searching stays for everyone else,
 * but what it produces is explicitly a bookmark: only the detected one records
 * an operator, and only an operator gets the buttons that sign.
 */
export default function AddValidatorModal({ open, onClose }: Props) {
  const navigate = useNavigate()
  const client = useWallet((state) => state.queryClient)
  const address = useWallet((state) => state.address)
  const add = useAccounts((state) => state.add)
  const accounts = useAccounts((state) => state.accounts)

  const [owned, setOwned] = useState<Validator | undefined>()
  const [checking, setChecking] = useState(false)
  const [validators, setValidators] = useState<Validator[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!open || !client) return

    let cancelled = false
    setChecking(true)
    setError(undefined)

    const run = async () => {
      const valoper = address ? toValoper(address) : undefined
      const [mine, all] = await Promise.all([
        valoper ? queryValidator(client, valoper) : Promise.resolve(undefined),
        queryValidators(client)
      ])
      if (cancelled) return
      setOwned(mine)
      setValidators(all)
      setChecking(false)
    }

    void run().catch((caught) => {
      if (cancelled) return
      setError(errorMessage(caught))
      setChecking(false)
    })

    return () => {
      cancelled = true
    }
  }, [open, client, address])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return validators.slice(0, 40)
    return validators
      .filter((v) => v.moniker.toLowerCase().includes(needle) || v.address.toLowerCase().includes(needle))
      .slice(0, 40)
  }, [validators, query])

  const choose = (validator: Validator, operator?: string) => {
    add({ kind: 'validator', valoper: validator.address, moniker: validator.moniker, operator })
    setQuery('')
    onClose()
    navigate('/validator')
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a validator">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {owned && address ? (
          <div className="flex items-center gap-3 rounded-card border border-border bg-surface p-4">
            <ValidatorAvatar address={owned.address} moniker={owned.moniker} size={36} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-label text-accent">
                <ShieldCheck size={13} aria-hidden />
                This wallet operates it
              </p>
              <p className="truncate text-base font-medium">{owned.moniker}</p>
            </div>
            <Button size="sm" onClick={() => choose(owned, address)}>
              Add
            </Button>
          </div>
        ) : null}

        <div className="flex items-center gap-2.5 rounded-control border border-border bg-surface px-3 py-2">
          <Search size={16} aria-hidden className="shrink-0 text-text-muted" />
          <input
            data-autofocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or address"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
          />
        </div>

        {error ? (
          <p className="text-base text-negative" role="alert">
            {error}
          </p>
        ) : null}

        <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto">
          {checking && validators.length === 0 ? (
            <li className="px-1 py-3 text-base text-text-muted">Reading the validator set…</li>
          ) : results.length === 0 ? (
            <li className="px-1 py-3 text-base text-text-muted">No validator matches that.</li>
          ) : (
            results.map((validator) => {
              const added = accounts.some((a) => a.valoper === validator.address)
              return (
                <li key={validator.address}>
                  <button
                    type="button"
                    onClick={() =>
                      choose(validator, validator.address === owned?.address ? address : undefined)
                    }
                    className="state-layer flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left"
                  >
                    <ValidatorAvatar address={validator.address} moniker={validator.moniker} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base">{validator.moniker}</span>
                      <span className="text-label text-text-faint">
                        {shortenAddress(validator.address, 14, 6)}
                      </span>
                    </span>
                    {added ? <Check size={16} aria-hidden className="shrink-0 text-accent" /> : null}
                  </button>
                </li>
              )
            })
          )}
        </ul>

        <p className="text-label text-text-faint">
          Adding one you do not operate is a bookmark — you can watch it, but not sign for it.
        </p>
      </div>
    </Modal>
  )
}
