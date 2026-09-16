import type { DeclaredMsg } from '@/lib/multisig/messages'

/**
 * The editor's rows, and what they amount to.
 *
 * In their own module rather than beside the component, so the component file
 * exports only components — which is what keeps fast refresh working while
 * somebody is editing the editor.
 */

export interface Row {
  id: number
  type?: string
  content: string
  error?: string
}

/** The rows that parse, as messages. A half-typed one is simply not there yet. */
export function toDeclared(rows: Row[]): DeclaredMsg[] {
  const declared: DeclaredMsg[] = []

  for (const row of rows) {
    if (!row.type || !row.content.trim()) continue
    try {
      declared.push({ template: row.type, content: JSON.parse(row.content) as Record<string, unknown> })
    } catch {
      // The row shows its own error; a proposal is simply not ready yet.
    }
  }

  return declared
}
