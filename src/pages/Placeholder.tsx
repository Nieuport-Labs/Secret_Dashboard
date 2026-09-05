import { Construction } from 'lucide-react'

/**
 * Stands in for a page a later phase builds. It names the phase rather than
 * showing a blank screen or fake data, so nobody mistakes an unbuilt page for a
 * broken one.
 */
export default function Placeholder({
  title,
  phase,
  summary
}: {
  title: string
  phase: string
  summary: string
}) {
  return (
    <section className="mx-auto max-w-[720px]">
      <h1 className="text-4xl font-semibold text-accent">{title}</h1>
      <div className="mt-6 flex items-start gap-3 rounded-card bg-surface p-5">
        <Construction size={20} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
        <div>
          <p className="text-base font-medium">Built in {phase}.</p>
          <p className="mt-1 text-base text-text-muted">{summary}</p>
        </div>
      </div>
    </section>
  )
}
