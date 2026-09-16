import { Check, Copy, Download, QrCode, Upload } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'

import Button from '@/components/ui/Button'
import { errorMessage } from '@/lib/errors'
import { decodeJson, decodeText, encodeJson, encodeText, type Envelope } from '@/lib/multisig/bundle'

/**
 * Getting a proposal to the other members, and their signatures back.
 *
 * There is no server here and nothing is posted anywhere: a bundle is a piece
 * of text, and it moves however the group already talks to each other. That is
 * a deliberate limit rather than an unfinished feature — the security of the
 * scheme does not depend on how a bundle travelled, because every bundle is
 * checked from scratch when it arrives. A tampered one costs a member one look
 * at a red checklist.
 *
 * Three routes, because they fail in different places. The clipboard is
 * fastest and loses the content if something else is copied in between; a file
 * survives being emailed; a QR code crosses to a phone with no shared network
 * at all — when it fits, which a proposal carrying an encrypted message
 * usually does not, and the component says so rather than rendering a code
 * nothing can read.
 */

/** Past this, a QR code needs a better camera than most people are holding. */
const QR_LIMIT = 1_200

export function ExportBundle({ envelope, filename }: { envelope: Envelope; filename: string }) {
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [error, setError] = useState<string>()

  let text = ''
  try {
    text = encodeText(envelope)
  } catch (caught) {
    return <p className="text-base text-negative">{errorMessage(caught)}</p>
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const download = () => {
    const blob = new Blob([encodeJson(envelope)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={copy}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="secondary" size="sm" icon={<Download size={15} />} onClick={download}>
          Download
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<QrCode size={15} />}
          onClick={() => setShowQr((current) => !current)}
          disabled={text.length > QR_LIMIT}
        >
          QR
        </Button>
      </div>

      {text.length > QR_LIMIT ? (
        <p className="text-label text-text-faint">
          Too long for a QR code — an encrypted message does not fit. Use the clipboard or the file.
        </p>
      ) : null}

      {showQr && text.length <= QR_LIMIT ? (
        <div className="max-w-[320px] rounded-card bg-white p-4">
          <QRCodeSVG value={text} size={300} level="M" className="h-auto w-full" title="Multisig bundle" />
        </div>
      ) : null}

      {error ? <p className="text-label text-negative">{error}</p> : null}
    </div>
  )
}

/**
 * Reading one in.
 *
 * Both text forms are accepted — the one-line form the clipboard carries and
 * the JSON a file holds — because a member should not have to know which one
 * they were sent. Neither is trusted: `parseEnvelope` runs either way, and
 * what comes back is handed on for checking, never acted on here.
 */
export function ImportBundle({
  onImport,
  label = 'Paste a proposal or a signature'
}: {
  onImport: (envelope: Envelope) => void
  label?: string
}) {
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string>()

  const read = (value: string) => {
    setRaw(value)
    setError(undefined)
    const trimmed = value.trim()
    if (!trimmed) return

    try {
      onImport(trimmed.startsWith('{') ? decodeJson(trimmed) : decodeText(trimmed))
      setRaw('')
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const readFile = async (file: File | undefined) => {
    if (!file) return
    try {
      read(await file.text())
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-text-muted">{label}</span>
        <textarea
          value={raw}
          onChange={(event) => read(event.target.value)}
          rows={3}
          spellCheck={false}
          className="rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex w-fit cursor-pointer items-center gap-1.5 text-base text-accent">
        <Upload size={15} />
        <span>Open a file</span>
        <input
          type="file"
          accept=".json,application/json,text/plain"
          className="hidden"
          onChange={(event) => void readFile(event.target.files?.[0])}
        />
      </label>

      {error ? <p className="text-base text-negative">{error}</p> : null}
    </div>
  )
}
