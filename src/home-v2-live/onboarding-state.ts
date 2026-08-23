export type HomeV2OnboardingStatus = 'completed' | 'in-progress' | 'skipped'
export type HomeV2OnboardingStep = 'account' | 'finish' | 'node'

export interface HomeV2OnboardingState {
  readonly currentStep: HomeV2OnboardingStep
  readonly status: HomeV2OnboardingStatus
  readonly version: 1
}

const steps = new Set<HomeV2OnboardingStep>(['account', 'finish', 'node'])
const statuses = new Set<HomeV2OnboardingStatus>([
  'completed',
  'in-progress',
  'skipped',
])

export function createHomeV2OnboardingState(
  status: HomeV2OnboardingStatus = 'in-progress',
  currentStep: HomeV2OnboardingStep = 'node',
): HomeV2OnboardingState {
  return Object.freeze({ currentStep, status, version: 1 as const })
}

export function parseHomeV2OnboardingState(
  value: unknown,
): HomeV2OnboardingState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<HomeV2OnboardingState>
  if (
    candidate.version !== 1 ||
    !steps.has(candidate.currentStep as HomeV2OnboardingStep) ||
    !statuses.has(candidate.status as HomeV2OnboardingStatus)
  ) {
    return null
  }
  return createHomeV2OnboardingState(candidate.status, candidate.currentStep)
}

export function advanceHomeV2Onboarding(
  state: HomeV2OnboardingState,
  currentStep: HomeV2OnboardingStep,
): HomeV2OnboardingState {
  return createHomeV2OnboardingState('in-progress', currentStep)
}

export function finishHomeV2Onboarding(
  status: Extract<HomeV2OnboardingStatus, 'completed' | 'skipped'>,
): HomeV2OnboardingState {
  return createHomeV2OnboardingState(status, 'finish')
}

export function initialHomeV2OnboardingStep(
  state: HomeV2OnboardingState,
): HomeV2OnboardingStep {
  return state.status === 'in-progress' ? state.currentStep : 'node'
}
