import { Server, Users } from 'lucide-react'

import ChoiceCard from '@/components/ui/ChoiceCard'
import Modal from '@/components/ui/Modal'

interface Props {
  open: boolean
  onClose: () => void
  onChooseValidator: () => void
  onChooseMultisig: () => void
}

/**
 * What kind of account is being added.
 *
 * The two are not the same kind of thing, and the descriptions say so. A
 * validator is this wallet wearing a different hat — switching to it changes
 * the screens, not the signer. A multisig is a different account altogether,
 * which this wallet may be a member of and can never move on its own.
 */
export default function AddAccountModal({ open, onClose, onChooseValidator, onChooseMultisig }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an account"
      description="Act as something other than this wallet."
    >
      <div className="flex flex-col gap-2">
        <ChoiceCard
          icon={Server}
          title="Validator"
          description="Run the dashboard as your validator — its stats, its votes, its commission."
          onClick={onChooseValidator}
        />
        <ChoiceCard
          icon={Users}
          title="Multisig"
          description="An account a group controls together. Create one, or add one you are a member of."
          onClick={onChooseMultisig}
        />
      </div>
    </Modal>
  )
}
