import { Globe } from 'lucide-react'

/**
 * The page's top-right strip. Holds the language picker now; the design puts
 * the gas-credits chip and the wallet chip here too once a wallet is connected
 * (Figma 34:660), which is why it is a row in the shell rather than something
 * the welcome screen positions on top of itself.
 */
export default function Header() {
  return (
    <div className="flex items-center justify-end gap-4 px-5 pt-6 lg:px-12">
      <button
        type="button"
        className="state-layer flex items-center gap-1.5 rounded-control px-2 py-1 text-base text-text"
      >
        <Globe size={16} aria-hidden />
        English
      </button>
    </div>
  )
}
