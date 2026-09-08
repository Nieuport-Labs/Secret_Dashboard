import { Server, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import Modal from '@/components/ui/Modal'
import { cn } from '@/lib/cn'

interface Props {
  open: boolean
  onClose: () => void
  onChooseValidator: () => void
}

/**
 * What kind of account is being added.
 *
 * Multisig is listed rather than hidden: an operator who came looking for it
 * should learn that it is coming, and a menu that silently lacks it reads as a
 * dashboard that never intends to have it.
 */
export default function AddAccountModal({ open, onClose, onChooseValidator }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an account"
      description="Act as something other than this wallet."
    >
      <div className="flex flex-col gap-2">
        <Choice
          icon={Server}
          title="Validator"
          description="Run the dashboard as your validator — its stats, its votes, its commission."
          onClick={onChooseValidator}
        />
        <Choice
          icon={Users}
          title="Multisig"
          description="Sign as a group. Not built yet."
          badge="In progress"
        />
      </div>
    </Modal>
  )
}

interface ChoiceProps {
  icon: LucideIcon
  title: string
  description: string
  onClick?: () => void
  badge?: string
}

function Choice({ icon: Icon, title, description, onClick, badge }: ChoiceProps) {
  const disabled = !onClick

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-start gap-3.5 rounded-card border border-border p-4 text-left',
        disabled ? 'cursor-not-allowed opacity-60' : 'state-layer'
      )}
    >
      <span
        aria-hidden
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent-container text-accent"
      >
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-title">{title}</span>
          {badge ? (
            <span className="rounded-pill border border-border px-2 py-0.5 text-label text-text-muted">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-base text-text-muted">{description}</span>
      </span>
    </button>
  )
}
