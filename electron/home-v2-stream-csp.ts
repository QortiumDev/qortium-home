// The private-attachment/resource stream serves one-time capability URLs on
// the qortium-home-resource: scheme (home-v2-desktop-resource-stream.ts).
// Rendered QDN apps arrive with a node-supplied CSP whose img-src is
// typically `'self' data: blob:` — which silently blocks that scheme, so a
// chat app's inline attachment reveal showed a broken image while every
// bridge call succeeded (observed live 2026-09-01; the feature had never
// displayed on desktop). This transform appends the scheme to exactly the
// directives the stream is consumed through: img-src (inline reveals),
// media-src (audio/video attachments) and connect-src (fetch-based readers),
// creating a directive from default-src when the policy omits it (otherwise
// the directive would inherit default-src and still exclude the scheme).
// Capability URLs stay useless cross-app: each token is bound to the issuing
// tab/account/session and expires, so widening CSP grants no reach by itself.
import { HOME_V2_RESOURCE_STREAM_SCHEME } from './home-v2-resource-stream-capability.js'

const STREAM_SOURCE = `${HOME_V2_RESOURCE_STREAM_SCHEME}:`
const STREAM_DIRECTIVES = ['connect-src', 'img-src', 'media-src'] as const

export function allowHomeV2ResourceStreamInCsp(csp: string): string {
  if (!csp.trim()) return csp

  const directives = csp.split(';').map((directive) => directive.trim()).filter(Boolean)
  const present = new Set(directives.map((directive) => directive.split(/\s+/)[0].toLowerCase()))
  const defaultSrc = directives.find((directive) => directive.split(/\s+/)[0].toLowerCase() === 'default-src')
  const defaultValues = defaultSrc ? defaultSrc.split(/\s+/).slice(1) : ["'self'"]

  const updated = directives.map((directive) => {
    const parts = directive.split(/\s+/)
    if (!(STREAM_DIRECTIVES as readonly string[]).includes(parts[0].toLowerCase())) return directive
    // `'none'` means "nothing at all" and must be REPLACED, not joined: a
    // source list containing 'none' plus anything else is invalid CSP.
    const values = new Set(parts.slice(1).filter((value) => value.toLowerCase() !== "'none'"))
    values.add(STREAM_SOURCE)
    return `${parts[0]} ${[...values].join(' ')}`
  })

  for (const directiveName of STREAM_DIRECTIVES) {
    if (!present.has(directiveName)) {
      const values = new Set(defaultValues.filter((value) => value.toLowerCase() !== "'none'"))
      values.add(STREAM_SOURCE)
      updated.push(`${directiveName} ${[...values].join(' ')}`)
    }
  }

  return updated.join('; ')
}
