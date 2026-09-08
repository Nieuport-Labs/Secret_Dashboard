import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

interface Props {
  command: string
  /** Names the command for a screen reader, which cannot see the label above it. */
  label: string
}

/**
 * A shell command meant to be copied and run somewhere else.
 *
 * Wraps rather than scrolls. These commands are long and the operator has to
 * read the address in the middle of one before pasting it into a terminal that
 * signs with their validator key — a single scrolling line hides exactly the
 * part worth checking.
 */
export default function CommandBlock({ command, label }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Refused clipboard access is not worth an error; the command is on screen
      // and selectable.
    }
  }

  return (
    <div className="flex items-start gap-2 rounded-control border border-border bg-surface p-3">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-sm text-text-muted">
        {command}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        className="state-layer flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1 text-label text-text-muted"
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
