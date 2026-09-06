/**
 * The panels the wallet's action row opens.
 *
 * Send, Receive and Wrap are side panels rather than routes: each acts on the
 * balances already on screen, and navigating away from them to perform the
 * action would drop the context the user is looking at. Bridge stays a page,
 * because choosing a chain and a route is a multi-step flow of its own.
 */
export type WalletPanel = 'send' | 'receive' | 'wrap'

export const PANEL_TITLES: Record<WalletPanel, string> = {
  send: 'Send',
  receive: 'Receive',
  wrap: 'Wrap'
}
