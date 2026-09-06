/**
 * Teaches Node two things Vite already knows: the `@/` alias, and that an
 * import without a file extension means a TypeScript file.
 *
 * The scripts in here run on plain Node, no bundler, so they keep working when
 * the app itself does not build. That is worth keeping, but it means the
 * resolution the source relies on has to be spelled out.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../src/', import.meta.url)

/** App source imports are extensionless; Node needs the real filename. */
function withExtension(url) {
  if (/\.[a-z]+$/i.test(url.pathname)) return url
  for (const candidate of [`${url.href}.ts`, `${url.href}.tsx`, `${url.href}/index.ts`]) {
    if (existsSync(fileURLToPath(candidate))) return new URL(candidate)
  }
  return url
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return nextResolve(withExtension(new URL(specifier.slice(2), SRC)).href, context)
  }

  // Relative imports between app modules are extensionless too.
  if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
    return nextResolve(withExtension(new URL(specifier, context.parentURL)).href, context)
  }

  return nextResolve(specifier, context)
}
