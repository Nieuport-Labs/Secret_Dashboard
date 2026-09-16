import { ChevronDown, Info, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { describeMessage, type DescribeContext } from '@/lib/multisig/describe'
import type { DeclaredMsg } from '@/lib/multisig/messages'

/**
 * One message, as a sentence rather than a data structure.
 *
 * The JSON is still one click away and always will be — a member who wants to
 * read the exact thing being signed must be able to, and for a message this
 * app does not recognise it is the only truthful rendering, so it is open from
 * the start. What changes is the default: the common case reads like the thing
 * it is ("Send 10 SCRT to secret1abc…"), because that is the sentence a group
 * agreed on, and comparing a sentence to a sentence is something people are
 * good at. Comparing a sentence to a block of JSON is what they are bad at,
 * and it is where a wrong recipient or a misplaced zero survives review.
 */
export default function MessageCard({
  message,
  index,
  context
}: {
  message: DeclaredMsg
  index: number
  context?: DescribeContext
}) {
  const summary = describeMessage(message, context)
  const [showRaw, setShowRaw] = useState(!summary.recognised)

  return (
    <li className="flex flex-col gap-3 rounded-card border border-border p-4">
      <div className="flex flex-col gap-1">
        <span className="text-label text-text-faint">
          Message {index + 1}
          {message.ciphertext ? ' · encrypted on the wire' : ''}
        </span>
        <h3 className="text-title">{summary.headline}</h3>
      </div>

      {summary.rows.length > 0 ? (
        <dl className="flex flex-col gap-1.5">
          {summary.rows.map((row) => (
            <div
              key={`${row.label}-${row.value}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
            >
              <dt className="min-w-[88px] text-label text-text-muted">{row.label}</dt>
              <dd className={row.mono ? 'min-w-0 break-all font-mono text-sm' : 'text-base'}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {summary.notes?.map((note) => (
        <p key={note} className="flex gap-2 text-label text-text-muted">
          {summary.recognised ? (
            <Info size={14} className="mt-0.5 shrink-0" />
          ) : (
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-accent" />
          )}
          <span>{note}</span>
        </p>
      ))}

      <div>
        <button
          type="button"
          onClick={() => setShowRaw((current) => !current)}
          className="flex items-center gap-1 text-label text-text-muted"
          aria-expanded={showRaw}
        >
          <ChevronDown
            size={13}
            aria-hidden
            className={showRaw ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
          {showRaw ? 'Hide the exact message' : 'Show the exact message'}
        </button>

        {showRaw ? (
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-control border border-border bg-surface p-3 font-mono text-sm text-text-muted">
            {JSON.stringify(message.content, null, 2)}
          </pre>
        ) : null}
      </div>
    </li>
  )
}
