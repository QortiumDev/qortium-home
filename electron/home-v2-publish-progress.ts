// Advisory only: the ordinary request result remains the sole authority for
// success, denial and unknown broadcast outcomes. Never include resource or
// account data in these messages.
export type HomeV2PublishPhase = 'preparing' | 'approval' | 'publishing'
export type HomeV2PublishProgress = (phase: HomeV2PublishPhase) => void

export function createHomeV2PublishProgress(
  protocol: string,
  request: unknown,
  deliver: (message: Record<string, unknown>) => void,
  isCurrent: () => boolean,
): HomeV2PublishProgress {
  const record = request && typeof request === 'object' ? request as Record<string, unknown> : {}
  const { progressId, action } = record
  const enabled = (protocol === 'qdnRequest' || protocol === 'qortalRequest') &&
    typeof progressId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(progressId) &&
    (action === 'PUBLISH_QDN_RESOURCE' || action === 'PUBLISH_CHAT_ATTACHMENT')
  let lastPhase = -1
  return (phase) => {
    try {
      const next = ['preparing', 'approval', 'publishing'].indexOf(phase)
      if (enabled && next > lastPhase && isCurrent()) {
        lastPhase = next
        deliver({ type: 'QDN_PUBLISH_PROGRESS', protocol, progressId, action, phase })
      }
    } catch {
      // A closed/navigated app or a failed progress transport cannot change
      // whether an approved request publishes, nor obscure its final result.
    }
  }
}
