/** Session consent is limited to Qortium account ratings, never resource ratings. */
export function isHomeV2AccountRatingSessionAction(action: string, protocol: string, writeKind?: string): boolean {
  return action === 'RATE_ACCOUNT' && protocol === 'qdnRequest' && writeKind === 'rating'
}

export function homeV2RatingPermissionScopes(action: string): readonly ('single-request' | 'session')[] {
  return action === 'RATE_ACCOUNT' ? ['single-request', 'session'] : ['single-request']
}

export function homeV2RatingPermissionSummary(appTitle: string, action: string): string {
  return action === 'RATE_ACCOUNT'
    ? `${appTitle} wants to submit this public, fee-free account rating. Allow for this tab also permits further account ratings, updates and removals across all roles from this app tab and selected account, without another prompt.`
    : `${appTitle} wants to submit this public, fee-free resource rating. This approval covers this one transaction only.`
}

export function homeV2RatingPermissionScopeDetail(action: string): string {
  return action === 'RATE_ACCOUNT'
    ? 'Once, or account ratings across all roles until this tab closes, the account locks or changes, or the node changes.'
    : 'This one transaction only'
}
