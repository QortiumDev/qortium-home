import assert from 'node:assert/strict'

import type { AppDescriptor, AppId, AppTabContext, TabId } from '../v2/contracts'
import {
  createProductState,
  reduceProductState,
  type ProductState,
} from '../v2/product-model'
import { buildAppResourceLocation } from '../v2/resource-location'
import {
  appDescriptorForOpenTab,
  resolveHomeV2PublishPreviewOpen,
} from './publish-preview-tab'

// The bug this file exists for: PREVIEW_QDN_PUBLISH_SOURCE returned true to the
// app -- "Preview opened in Home" -- while the shell dropped the payload in
// silence, because it resolved the requesting app out of `HomeV2Snapshot.apps`
// and the live shell never populates that list. Every assertion below is about
// the shell being able to open a preview for a tab NO CATALOGUE KNOWS ABOUT,
// which is every tab the live shell has.

const brand = <T,>(value: string) => value as T

const SOURCE_TAB = brand<TabId>('home-v2:tab:source')
const PREVIEW_TAB = brand<TabId>('home-v2:tab:preview')
const APP_ID = brand<AppId>('home-v2:app:qortium:Explore:Explore')
const PREVIEW_URL = 'http://127.0.0.1:24891/render/hash/2TZX8MTjxbNaQRovthrPxcs1A3Qgas'

// Built exactly the way HomeV2LiveApp's openAddress builds one, which is the
// ONLY way an app tab is ever opened in the live shell: on the spot, from an
// address, never from a catalogue.
const exploreApp: AppDescriptor = {
  id: APP_ID,
  title: 'Explore',
  description: 'QDN app from Qortium.',
  category: 'utility',
  sourceNetwork: 'qortium',
  resourceIdentity: { service: 'APP', name: 'Explore', identifier: 'Explore' },
  targetNetworks: ['qortium'],
  placement: 'recommended',
}

const sourceContext: AppTabContext = {
  appId: APP_ID,
  identityId: brand('home-v2:identity:alice'),
  previewUrl: null,
  resourceLocation: buildAppResourceLocation('qortium', exploreApp.resourceIdentity),
  sourceNetwork: 'qortium',
  tabId: SOURCE_TAB,
  walletRef: brand('home-v2:wallet:alice'),
}

function openedShell(): ProductState {
  return reduceProductState(createProductState(), {
    type: 'open-app',
    app: exploreApp,
    context: sourceContext,
    tabId: SOURCE_TAB,
  })
}

const payload = {
  network: 'qortium',
  previewUrl: PREVIEW_URL,
  service: 'WEBSITE',
  sourceTabId: SOURCE_TAB,
  title: 'index.html',
}

// 1. The regression. A tab opened from an address -- the live shell's only kind
//    -- must resolve, with no catalogue anywhere in sight.
{
  const state = openedShell()
  const opened = resolveHomeV2PublishPreviewOpen(payload, state.tabs, PREVIEW_TAB)
  assert.ok(opened, 'a preview for an open app tab must resolve')
  assert.equal(opened.app.id, APP_ID)
  assert.equal(opened.app.sourceNetwork, 'qortium')
  assert.deepEqual(opened.app.resourceIdentity, {
    service: 'APP',
    name: 'Explore',
    identifier: 'Explore',
  })
  assert.equal(opened.context.previewUrl, PREVIEW_URL)
  assert.equal(opened.context.tabId, PREVIEW_TAB)
  // The preview borrows the requesting tab's identity and address.
  assert.equal(opened.context.appId, sourceContext.appId)
  assert.equal(opened.context.identityId, sourceContext.identityId)
  assert.equal(opened.context.walletRef, sourceContext.walletRef)
  assert.equal(opened.context.resourceLocation, sourceContext.resourceLocation)
}

// 2. The reducer must ACCEPT it. assertAppTabTarget re-checks that the
//    descriptor and the context name the same app, tab and resource, so a
//    resolver that returned a plausible-looking mismatch would throw at
//    dispatch and lose the preview a second way.
{
  const state = openedShell()
  const opened = resolveHomeV2PublishPreviewOpen(payload, state.tabs, PREVIEW_TAB)
  assert.ok(opened)
  const next = reduceProductState(state, {
    type: 'open-app',
    app: opened.app,
    context: opened.context,
    tabId: PREVIEW_TAB,
  })
  assert.equal(next.tabs.length, 2, 'the preview must open BESIDE the app, not replace it')
  assert.equal(next.activeTabId, PREVIEW_TAB)
  const preview = next.tabs.find((tab) => tab.id === PREVIEW_TAB)
  assert.equal(preview?.context.previewUrl, PREVIEW_URL)
  // The app that asked is untouched and still has no preview of its own.
  const source = next.tabs.find((tab) => tab.id === SOURCE_TAB)
  assert.equal(source?.context.previewUrl, null)

  // The SAME preview URL again is the same tab, activated rather than
  // duplicated; a preview of a DIFFERENT file is a tab of its own.
  const secondTab = brand<TabId>('home-v2:tab:preview-2')
  const again = reduceProductState(next, {
    type: 'open-app',
    app: opened.app,
    context: { ...opened.context, tabId: secondTab },
    tabId: secondTab,
  })
  assert.equal(again.tabs.length, 2, 'the same preview URL must not open twice')
  assert.equal(again.activeTabId, PREVIEW_TAB)

  const otherFile = resolveHomeV2PublishPreviewOpen(
    { ...payload, previewUrl: `${PREVIEW_URL}9`, title: 'other.html' },
    state.tabs,
    secondTab,
  )
  assert.ok(otherFile)
  const both = reduceProductState(next, {
    type: 'open-app',
    app: otherFile.app,
    context: otherFile.context,
    tabId: secondTab,
  })
  assert.equal(both.tabs.length, 3, 'a preview of another file must open its own tab')
}

// 3. The tab's title. The bridge sends the picked file's BASENAME and the shell
//    used to ignore it, leaving the preview wearing the app's own name.
{
  const state = openedShell()
  const opened = resolveHomeV2PublishPreviewOpen(payload, state.tabs, PREVIEW_TAB)
  assert.equal(opened?.app.title, 'index.html')

  const untitled = resolveHomeV2PublishPreviewOpen(
    { ...payload, title: '   ' },
    state.tabs,
    PREVIEW_TAB,
  )
  assert.equal(untitled?.app.title, 'Explore', 'an unusable title falls back to the tab title')

  const hostile = resolveHomeV2PublishPreviewOpen(
    { ...payload, title: 'index‮.html\nSAFE' },
    state.tabs,
    PREVIEW_TAB,
  )
  assert.equal(hostile?.app.title, 'index .html SAFE', 'the title must be sanitized')
}

// 4. Everything that must be refused, quietly.
{
  const state = openedShell()
  assert.equal(resolveHomeV2PublishPreviewOpen(null, state.tabs, PREVIEW_TAB), null)
  assert.equal(resolveHomeV2PublishPreviewOpen('nope', state.tabs, PREVIEW_TAB), null)
  assert.equal(
    resolveHomeV2PublishPreviewOpen({ ...payload, previewUrl: '' }, state.tabs, PREVIEW_TAB),
    null,
    'a payload with no preview URL must be refused',
  )
  assert.equal(
    resolveHomeV2PublishPreviewOpen({ ...payload, sourceTabId: '' }, state.tabs, PREVIEW_TAB),
    null,
  )
  assert.equal(
    resolveHomeV2PublishPreviewOpen(
      { ...payload, sourceTabId: 'home-v2:tab:closed' },
      state.tabs,
      PREVIEW_TAB,
    ),
    null,
    'a preview for a tab that has since closed must be refused',
  )
  // No app tabs open at all: createProductState starts on the dashboard.
  assert.equal(
    resolveHomeV2PublishPreviewOpen(payload, createProductState().tabs, PREVIEW_TAB),
    null,
  )
}

// 5. appDescriptorForOpenTab refuses a tab whose own address no longer agrees
//    with it, rather than manufacturing a descriptor the reducer would reject.
{
  const state = openedShell()
  const [tab] = state.tabs
  assert.ok(appDescriptorForOpenTab(tab))
  assert.equal(
    appDescriptorForOpenTab({
      ...tab,
      context: { ...tab.context, resourceLocation: brand('not-an-address') },
    }),
    null,
  )
  assert.equal(
    appDescriptorForOpenTab({
      ...tab,
      context: { ...tab.context, sourceNetwork: 'qortal' },
    }),
    null,
    'a tab whose address and source chain disagree must not yield a descriptor',
  )
}

console.log('Home 2 publish preview tab tests passed.')
