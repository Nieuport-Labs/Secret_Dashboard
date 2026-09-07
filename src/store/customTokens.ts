import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { TokenInfo } from '@/tokens/registry'

/**
 * Tokens the user added by contract address, on top of the built-in registry.
 *
 * Kept separate from `TOKENS` itself so the registry can stay a static,
 * reviewable list — nothing chain-supplied gets merged into the file everyone
 * reads to know what this dashboard recognizes.
 */

interface CustomTokensState {
  tokens: TokenInfo[]
  add: (token: TokenInfo) => void
  remove: (address: string) => void
}

export const useCustomTokens = create<CustomTokensState>()(
  persist(
    (set, get) => ({
      tokens: [],
      add: (token) => {
        if (get().tokens.some((existing) => existing.address === token.address)) return
        set({ tokens: [...get().tokens, token] })
      },
      remove: (address) => set({ tokens: get().tokens.filter((token) => token.address !== address) })
    }),
    { name: 'secret-dashboard:custom-tokens' }
  )
)
