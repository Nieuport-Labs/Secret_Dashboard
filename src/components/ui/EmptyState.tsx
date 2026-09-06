import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  icon: LucideIcon
  title: string
  /** One sentence. What this page is for, or why it is empty. */
  description: string
  /** The single thing to do next, if there is one. */
  action?: ReactNode
}

/**
 * What a page shows when it has nothing to show.
 *
 * A whole route reduced to one grey sentence reads as a page that failed to
 * load rather than one waiting for you, so this gives the state a shape: the
 * page's own icon, a title in the page's voice, the reason, and — where there
 * is one — the single action that ends it.
 */
export default function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="mx-auto flex max-w-[420px] flex-col items-center py-16 text-center">
      <span
        aria-hidden
        className="flex size-11 items-center justify-center rounded-pill bg-accent-container text-accent"
      >
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <h2 className="mt-4 text-title">{title}</h2>
      <p className="mt-1.5 text-balance text-base text-text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
