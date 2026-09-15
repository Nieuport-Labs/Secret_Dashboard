import { Eye, EyeOff } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePrivacy } from '@/store/privacy'

/**
 * The eye in the header: hide every balance and address at once.
 *
 * In the top bar rather than in settings because of when it is reached for —
 * halfway through a screen share, with a support chat already open. A privacy
 * switch two menus deep is one nobody finds in time, and this one has to be
 * findable by someone who has never looked for it before.
 */
export default function PrivacyToggle() {
  const hidden = usePrivacy((state) => state.hidden)
  const toggle = usePrivacy((state) => state.toggle)

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      title={
        hidden
          ? 'Show balances and addresses again'
          : 'Hide every balance and address — for screenshots and screen shares'
      }
      className={cn(
        'state-layer flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-base font-medium',
        hidden ? 'text-accent' : 'text-text-muted'
      )}
    >
      {hidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
      <span className="sr-only">
        {hidden ? 'Show balances and addresses' : 'Hide balances and addresses'}
      </span>
    </button>
  )
}
