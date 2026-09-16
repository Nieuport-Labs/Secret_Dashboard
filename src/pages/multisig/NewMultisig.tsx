import { AlertTriangle, Check, Plus, Search, Trash2, UserPlus, Users } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import CommandBlock from '@/components/ui/CommandBlock'
import { BECH32_PREFIX } from '@/chains/secret4'
import { isValidBech32 } from '@/lib/bech32'
import { errorMessage } from '@/lib/errors'
import { pubkeyForAddress } from '@/lib/multisig/account'

import {
  addressForPubkey,
  createConfig,
  deriveMultisig,
  fingerprint,
  parseConfig,
  validateConfig,
  type ConfigProblem,
  type MultisigConfig
} from '@/lib/multisig/config'
import { shortenAddress } from '@/lib/format'
import { adoptMultisig } from '@/store/multisig'
import { useWallet } from '@/store/wallet'

/**
 * Creating a multisig, or adding one somebody else created.
 *
 * The screen is arranged around the one thing that cannot be undone: the
 * address. It is a hash of the member keys and the threshold, so a single
 * wrong key produces a perfectly valid address that nobody holds the keys to,
 * and anything sent there is gone. Nothing here is written to the chain and
 * nothing costs anything — which means there is no "are you sure" moment to
 * hide behind, and the address has to be checked *before* the account is used
 * rather than after.
 *
 * So the address is shown continuously as members are added, with the
 * fingerprint beside it, and with the `secretcli` command that produces the
 * same account. Every member should end up looking at the same twenty
 * characters before anybody sends it anything.
 */
export default function NewMultisig() {
  const [tab, setTab] = useState<'create' | 'import'>('create')

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-display">Multisig</h1>
        <p className="text-base text-text-muted">
          An account controlled by several keys together. Nothing is written to the chain: the address is
          worked out from the members and the threshold, so everyone who builds the same list gets the same
          account.
        </p>
      </header>

      <div className="flex gap-1 rounded-pill border border-border p-1 self-start">
        <TabButton active={tab === 'create'} onClick={() => setTab('create')}>
          Create one
        </TabButton>
        <TabButton active={tab === 'import'} onClick={() => setTab('import')}>
          Add an existing one
        </TabButton>
      </div>

      {tab === 'create' ? <CreateMultisig /> : <ImportMultisig />}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-pill bg-accent-container px-3.5 py-1.5 text-base font-medium text-accent'
          : 'state-layer rounded-pill px-3.5 py-1.5 text-base text-text-muted'
      }
    >
      {children}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

interface MemberDraft {
  id: number
  /** What the person typed: a key, or an address to look one up from. */
  input: string
  pubkey?: string
  label?: string
  error?: string
  looking?: boolean
}

function CreateMultisig() {
  const navigate = useNavigate()
  const client = useWallet((state) => state.queryClient)
  const walletAddress = useWallet((state) => state.address)

  const nextId = useRef(2)
  const [label, setLabel] = useState('')
  const [threshold, setThreshold] = useState(2)
  const [members, setMembers] = useState<MemberDraft[]>([
    { id: 0, input: '' },
    { id: 1, input: '' }
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const keys = members.map((member) => member.pubkey).filter((key): key is string => Boolean(key))
  const keysKey = keys.join(',')

  /**
   * The account these keys make, recomputed on every keystroke.
   *
   * Derived rather than stored so it cannot lag behind the list it describes:
   * an address on screen that belongs to a member set from two edits ago is
   * worse than no address at all.
   */
  const derived = useMemo(() => {
    const list = keysKey ? keysKey.split(',') : []
    if (list.length === 0 || threshold < 1 || threshold > list.length) return undefined
    try {
      return deriveMultisig(list, threshold)
    } catch {
      return undefined
    }
  }, [keysKey, threshold])

  // Cheap enough to redo every render, and one less thing that can go stale.
  const problems: ConfigProblem[] = (() => {
    if (!derived) return []
    try {
      return validateConfig(
        createConfig({
          label: label || 'Multisig',
          threshold,
          members: members
            .filter((member) => member.pubkey)
            .map((member) => ({ pubkey: member.pubkey!, label: member.label }))
        })
      )
    } catch {
      return []
    }
  })()

  const update = (id: number, patch: Partial<MemberDraft>) =>
    setMembers((current) => current.map((member) => (member.id === id ? { ...member, ...patch } : member)))

  /**
   * One field for both kinds of input.
   *
   * A public key is what the account is actually made of, but nobody has one
   * to hand — what people have is each other's addresses. An address cannot be
   * turned back into a key locally (it is a hash), so the chain is asked for
   * the key it recorded the first time that account signed something. An
   * account that has never signed has no key on chain, and the message says
   * exactly that rather than "not found".
   *
   * Run as the field changes rather than when it is left, so that pasting a
   * key shows the account it belongs to straight away. Nothing is spent on a
   * half-typed field: a key is checked locally, and the chain is only asked
   * once the text is a complete, checksum-valid address.
   */
  const resolve = async (id: number, raw: string) => {
    const input = raw.trim()
    if (!input) return update(id, { pubkey: undefined, error: undefined })

    if (isValidBech32(input, BECH32_PREFIX)) {
      if (!client) return update(id, { error: 'Not connected to a node yet.' })
      update(id, { looking: true, error: undefined })
      try {
        const pubkey = await pubkeyForAddress(client, input)
        if (!pubkey) {
          update(id, {
            looking: false,
            pubkey: undefined,
            error:
              'This account has never signed anything, so the chain does not know its public key. Ask them ' +
              'for the key itself.'
          })
          return
        }
        update(id, { looking: false, pubkey, error: undefined })
      } catch (caught) {
        update(id, { looking: false, error: errorMessage(caught) })
      }
      return
    }

    try {
      addressForPubkey(input)
      update(id, { pubkey: input, error: undefined })
    } catch (caught) {
      // A compressed key is 44 characters of base64. Anything shorter is
      // somebody still typing, and telling them off mid-word is noise.
      const typing = input.length < 44
      update(id, { pubkey: undefined, error: typing ? undefined : errorMessage(caught) })
    }
  }

  const addMe = async () => {
    if (!walletAddress || !client) return
    const empty = members.find((member) => !member.input.trim())
    const id = empty?.id ?? nextId.current++
    if (!empty) setMembers((current) => [...current, { id, input: walletAddress }])
    else update(id, { input: walletAddress })
    await resolve(id, walletAddress)
  }

  const create = () => {
    setError(undefined)
    try {
      setSaving(true)
      const config = createConfig({
        label: label.trim() || 'Multisig',
        threshold,
        members: members
          .filter((member) => member.pubkey)
          .map((member) => ({ pubkey: member.pubkey!, label: member.label?.trim() || undefined }))
      })
      adoptMultisig(config)
      navigate('/multisig')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  const blocking = problems.some((problem) => problem.severity === 'error')
  const ready = Boolean(derived) && keys.length >= 2 && !blocking

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-text-muted">Name</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Treasury"
            className="rounded-control border border-border bg-surface px-3 py-2 text-base outline-none focus:border-accent"
          />
          <span className="text-label text-text-faint">
            Yours alone. It is not part of the account and nobody else sees it.
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-title">Members</h2>
          <Button
            variant="text"
            size="sm"
            icon={<UserPlus size={15} />}
            onClick={addMe}
            disabled={!walletAddress}
          >
            Add me
          </Button>
        </div>

        <ul className="flex flex-col gap-2">
          {members.map((member, index) => (
            <li key={member.id} className="flex flex-col gap-1.5 rounded-card border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="text-label text-text-faint">{index + 1}</span>
                <input
                  value={member.input}
                  onChange={(event) => {
                    update(member.id, { input: event.target.value })
                    void resolve(member.id, event.target.value)
                  }}
                  placeholder="secret1… or a public key"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                />
                {members.length > 2 ? (
                  <button
                    type="button"
                    aria-label={`Remove member ${index + 1}`}
                    onClick={() => setMembers((current) => current.filter((entry) => entry.id !== member.id))}
                    className="state-layer rounded-control p-2 text-text-muted"
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>

              {member.looking ? (
                <p className="flex items-center gap-1.5 text-label text-text-muted">
                  <Search size={13} /> Asking the chain for this account’s key…
                </p>
              ) : member.error ? (
                <p className="text-label text-negative">{member.error}</p>
              ) : member.pubkey ? (
                <p className="flex items-center gap-1.5 text-label text-text-muted">
                  <Check size={13} className="text-positive" />
                  <span className="font-mono">{shortenAddress(addressForPubkey(member.pubkey), 14, 6)}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        <Button
          variant="text"
          size="sm"
          icon={<Plus size={15} />}
          onClick={() => setMembers((current) => [...current, { id: nextId.current++, input: '' }])}
        >
          Add a member
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-title">Threshold</h2>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={Math.max(keys.length, 1)}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            className="w-20 rounded-control border border-border bg-surface px-3 py-2 text-base outline-none focus:border-accent"
          />
          <span className="text-base text-text-muted">
            of {keys.length || '—'} signatures needed to move anything
          </span>
        </div>
      </section>

      {derived ? (
        <DerivedAccount
          address={derived.address}
          order={derived.order}
          threshold={threshold}
          problems={problems}
        />
      ) : (
        <p className="rounded-card border border-border p-4 text-base text-text-muted">
          Add at least two members to see the account they make.
        </p>
      )}

      {error ? <p className="text-base text-negative">{error}</p> : null}

      <div className="flex justify-end">
        <Button onClick={create} disabled={!ready} loading={saving} icon={<Users size={16} />}>
          Create this account
        </Button>
      </div>
    </div>
  )
}

/**
 * The address, and everything that makes checking it possible.
 *
 * The `secretcli` command is not decoration. It is the independent second
 * opinion: a member who runs it gets the address from the reference
 * implementation rather than from this app, which is the only way to catch a
 * bug in this app before it costs somebody their funds.
 */
function DerivedAccount({
  address,
  order,
  threshold,
  problems
}: {
  address: string
  order: string[]
  threshold: number
  problems: ConfigProblem[]
}) {
  const keys = order.map((key) => `"${key}"`).join(' ')

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <span className="text-label text-text-muted">This account</span>
        <code className="break-all font-mono text-base text-text">{address}</code>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-label text-text-muted">Fingerprint</span>
        <code className="font-mono text-base tracking-wide text-text">{fingerprint(threshold, order)}</code>
        <span className="text-label text-text-faint">
          Read this to the other members before anyone sends anything here. It covers the same thing the
          address does — the members and the threshold — and survives being read down a phone line.
        </span>
      </div>

      {problems.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {problems.map((problem) => (
            <li
              key={problem.message}
              className={
                problem.severity === 'error'
                  ? 'flex gap-2 text-base text-negative'
                  : 'flex gap-2 text-base text-text-muted'
              }
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{problem.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="text-base">
        <summary className="cursor-pointer text-text-muted">Check it with secretcli</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-label text-text-faint">
            Import each member key and build the account. It should print exactly the address above.
          </p>
          <CommandBlock
            label="secretcli equivalent"
            command={`# for each member key\nsecretcli keys add member1 --pubkey '{"@type":"/cosmos.crypto.secp256k1.PubKey","key":${keys.split(' ')[0]}}'\n\nsecretcli keys add group --multisig member1,member2 --multisig-threshold ${threshold}`}
          />
        </div>
      </details>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Adding an account somebody else built.
 *
 * The text is checked before it is anything: the parser refuses unknown
 * fields, malformed keys and — the one that matters — a configuration whose
 * stated address is not the one its own keys produce. Only then is it shown,
 * and only then can it be kept.
 */
function ImportMultisig() {
  const navigate = useNavigate()
  const [raw, setRaw] = useState('')
  const [parsed, setParsed] = useState<MultisigConfig>()
  const [error, setError] = useState<string>()

  const read = (value: string) => {
    setRaw(value)
    setParsed(undefined)
    setError(undefined)
    if (!value.trim()) return

    try {
      setParsed(parseConfig(value))
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-text-muted">The account, as another member exported it</span>
        <textarea
          value={raw}
          onChange={(event) => read(event.target.value)}
          rows={8}
          spellCheck={false}
          placeholder="Paste the exported account here"
          className="rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
      </label>

      {error ? <p className="text-base text-negative">{error}</p> : null}

      {parsed ? (
        <>
          <DerivedAccount
            address={parsed.address}
            order={parsed.members.map((member) => member.pubkey)}
            threshold={parsed.threshold}
            problems={validateConfig(parsed)}
          />
          <div className="flex justify-end">
            <Button
              onClick={() => {
                adoptMultisig(parsed)
                navigate('/multisig')
              }}
              icon={<Users size={16} />}
            >
              Add {parsed.label || 'this account'}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
