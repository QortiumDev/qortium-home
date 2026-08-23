import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { createHomeV2OnboardingState } from '../../home-v2-live/onboarding-state'
import { homeV2Fixture } from '../test-kit/fixtures'
import { HomeV2CoreApiDocsPage } from './HomeV2CoreApiDocsPage'
import { HomeV2WelcomePage } from './HomeV2WelcomePage'

for (const step of ['node', 'account', 'finish'] as const) {
  const html = renderToStaticMarkup(
    <HomeV2WelcomePage
      onboarding={createHomeV2OnboardingState('in-progress', step)}
      snapshot={homeV2Fixture}
      onAccountAction={() => undefined}
      onComplete={() => undefined}
      onConfigureCustomNode={() => undefined}
      onOpenNames={() => undefined}
      onSetNodeMode={() => undefined}
      onSkip={() => undefined}
      onStepChange={() => undefined}
    />,
  )
  assert.match(html, /home:\/\/welcome/)
  assert.match(html, /Skip setup/)
  assert.match(html, new RegExp(`data-current="true"[^>]*><span>${step === 'node' ? 1 : step === 'account' ? 2 : 3}`))
}

const docs = renderToStaticMarkup(
  <HomeV2CoreApiDocsPage
    network="qortal"
    probe={async () => ({ status: 200 })}
    snapshot={homeV2Fixture}
    transport="desktop"
  />,
)
assert.match(docs, /qortal-core:\/\//)
assert.match(docs, /Checking the node&#x27;s API documentation/)

console.log('Home v2 retained page UI tests passed.')
