import assert from 'node:assert/strict'
import {
  advanceHomeV2Onboarding,
  createHomeV2OnboardingState,
  finishHomeV2Onboarding,
  initialHomeV2OnboardingStep,
  parseHomeV2OnboardingState,
} from './onboarding-state'

const fresh = createHomeV2OnboardingState()
assert.deepEqual(fresh, { currentStep: 'node', status: 'in-progress', version: 1 })
assert.deepEqual(advanceHomeV2Onboarding(fresh, 'account'), {
  currentStep: 'account',
  status: 'in-progress',
  version: 1,
})
assert.deepEqual(finishHomeV2Onboarding('completed'), {
  currentStep: 'finish',
  status: 'completed',
  version: 1,
})
assert.equal(initialHomeV2OnboardingStep(finishHomeV2Onboarding('skipped')), 'node')
assert.deepEqual(
  parseHomeV2OnboardingState({ currentStep: 'finish', status: 'skipped', version: 1 }),
  { currentStep: 'finish', status: 'skipped', version: 1 },
)
for (const value of [
  null,
  {},
  { currentStep: 'other', status: 'in-progress', version: 1 },
  { currentStep: 'node', status: 'other', version: 1 },
  { currentStep: 'node', status: 'in-progress', version: 2 },
]) {
  assert.equal(parseHomeV2OnboardingState(value), null)
}

console.log('Home v2 onboarding state tests passed.')
