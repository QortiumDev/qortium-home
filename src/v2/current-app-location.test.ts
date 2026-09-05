import assert from 'node:assert/strict'
import type { AppDescriptor, AppTabContext } from './contracts'
import { currentAppLocation, currentAppLocationFromRender, validateCurrentAppLocation } from './current-app-location'
import { createProductState, reduceProductState, restoreProductState } from './product-model'
import { parseAppResourceLocation } from './resource-location'
import { rememberClosedAppTab } from '../home-v2-live/closed-app-tabs'
import { resolveAccountTabLaunch } from '../home-v2-live/account-tab-launch'

function context(location: string): AppTabContext {
  return { appId: 'app', tabId: 'tab', resourceLocation: location,
    sourceNetwork: location.startsWith('qortal:') ? 'qortal' : 'qortium',
    identityId: 'home-v2:identity:wallet:B:2', walletRef: 'home-v2:wallet:B' } as AppTabContext
}
for (const scheme of ['qdn', 'qortal']) for (const service of ['APP', 'WEBSITE', 'GAME']) {
  const base = `${scheme}://${service}/Fixture/published`
  const ctx = context(`${base}/start?old=1#initial`)
  const render = `https://node.example/render/${service}/Fixture/published/start?theme=dark`
  const live = `https://node.example/render/${service}/Fixture/published/a//page%20two/?x=hello%20world&x=two+words&homeV2Bridge=1&qdn%48omeBridge=secret&apiKey=secret&theme=light#message`
  const wanted = `${base}/a//page%20two/?x=hello%20world&x=two+words#message`
  assert.equal(currentAppLocationFromRender(ctx, live, render), wanted)
  assert.equal(parseAppResourceLocation(wanted).location, wanted)
  assert.equal(currentAppLocationFromRender(ctx, render, render), `${base}/start`)
  assert.equal(currentAppLocationFromRender(ctx, live.replace('node.example', 'other.example'), render), null)
  assert.equal(currentAppLocationFromRender(ctx, live.replace('/Fixture/', '/Other/'), render), null)
  assert.equal(currentAppLocationFromRender(ctx, live.replace('/published/', '/other/'), render), null)
  assert.equal(currentAppLocationFromRender(ctx, live.replace(`/render/${service}/`, '/render/IMAGE/'), render), null)
  assert.equal(currentAppLocationFromRender(ctx, live.replace('https://', 'https://user:password@'), render), null)
  assert.equal(currentAppLocationFromRender({...ctx, previewUrl: render}, live, render), null)
  for (const invalid of ['https://node.example/page', base.replace('Fixture', 'Other'), base.replace(scheme, scheme === 'qdn' ? 'qortal' : 'qdn'), `${base}?identifier=other`, `${base}/%zz`, `${base}/${'a'.repeat(2001)}`]) {
    assert.equal(validateCurrentAppLocation(ctx, invalid), null, invalid)
  }

  const app = { id: ctx.appId, title: 'Fixture', sourceNetwork: ctx.sourceNetwork,
    resourceIdentity: parseAppResourceLocation(ctx.resourceLocation).identity } as AppDescriptor
  let state = reduceProductState(createProductState(), { type: 'open-app', app, context: ctx, tabId: ctx.tabId })
  const launch = state.tabs[0].context
  state = reduceProductState(state, { type: 'set-tab-current-location', tabId: ctx.tabId,
    fromResourceLocation: ctx.resourceLocation, location: wanted })
  assert.deepEqual(state.tabs[0].context, launch, 'Navigation does not mutate permission/account/wallet context')
  assert.equal(currentAppLocation(state.tabs[0]), wanted)
  assert.equal(currentAppLocation(state.entries.find(e => e.kind === 'app') as typeof state.tabs[0]), wanted)
  assert.equal(reduceProductState(state, {type:'set-tab-current-location', tabId:ctx.tabId, fromResourceLocation:'stale', location:base}), state)
  assert.equal(reduceProductState(state, {type:'set-tab-current-location', tabId:'gone' as AppTabContext['tabId'], fromResourceLocation:ctx.resourceLocation, location:base}), state)
  const restored = restoreProductState(JSON.parse(JSON.stringify(state)))
  assert.equal(restored.tabs[0].context.resourceLocation, wanted)
  assert.equal(restored.tabs[0].context.identityId, launch.identityId)
  const closed = rememberClosedAppTab([], state.tabs[0])[0]
  assert.equal(closed.resourceLocation, wanted)
  assert.equal(closed.accountId, 'wallet:B:2')
  const duplicate = resolveAccountTabLaunch({ tabs:state.tabs, tabId:ctx.tabId, resourceLocation:ctx.resourceLocation, accountId:null, accounts:[] })
  assert.equal(duplicate.resourceLocation, wanted)
  assert.equal(duplicate.accountId, null)
  const replaced = reduceProductState(state, {type:'replace-tab-app', app, tabId:ctx.tabId,
    context:{...ctx,resourceLocation:`${base}/replacement` as AppTabContext['resourceLocation']}, fromResourceLocation:ctx.resourceLocation})
  assert.equal(replaced.tabs[0].currentResourceLocation, undefined)
}

const base = 'qdn://APP/Fixture/default'
assert.equal(parseAppResourceLocation('qdn://APP//Fixture//published/a//b/').location,
  'qdn://APP/Fixture/published/a//b/', 'Preserve legacy normalization only in identity slots')
const ctx = context(`${base}?old=1#start`)
const render = 'http://127.0.0.1:54321/render/APP/Fixture?homeV2Bridge=1&qdnHomeBridge=token'
assert.equal(currentAppLocationFromRender(ctx, `${render}&room=7#end`, render), `${base}?room=7#end`)
assert.equal(currentAppLocationFromRender(ctx, render.replace('/Fixture?', '/Fixture/ambiguous?'), render), null, 'Do not weaken default identifier path confinement')
for (const route of ['/', '/default/', '/Default/somePage']) {
  assert.equal(currentAppLocationFromRender(ctx, render.replace('/Fixture?', `/Fixture${route}?`), render), `${base}${route}`)
}
const override = context(`${base}?identifier=published`)
const overrideCurrent = currentAppLocationFromRender(override,
  'https://node/render/APP/Fixture/published/page?identifier=published#x',
  'https://node/render/APP/Fixture?identifier=published')
assert.equal(overrideCurrent, 'qdn://APP/Fixture/published/page?identifier=published#x')
const closedOverride = rememberClosedAppTab([], {id:override.tabId,appId:override.appId,title:'Fixture',
  context:override,currentResourceLocation:overrideCurrent!})[0]
assert.equal(closedOverride.app.resourceIdentity.identifier,'published')
assert.doesNotThrow(() => reduceProductState(createProductState(), {type:'open-app',tabId:override.tabId,
  app:closedOverride.app,context:{...override,resourceLocation:closedOverride.resourceLocation}}))
const archive = 'file:///tmp/qdn-archive-render/cache/contents/'
const archiveRender = `${archive}index.html?theme=dark`
// Viewer/archive URLs are outside this app-tab tranche; never leak file paths.
assert.equal(currentAppLocationFromRender(ctx, archiveRender, archiveRender), null)
const legacy = {kind:'app',id:ctx.tabId,appId:ctx.appId,title:'Fixture',context:ctx}
assert.equal(restoreProductState({entries:[legacy]}).tabs[0].context.resourceLocation, ctx.resourceLocation)
assert.equal(restoreProductState({entries:[{...legacy,currentResourceLocation:'qortal://APP/Evil/default'}]}).tabs[0].context.resourceLocation, ctx.resourceLocation)
console.log('Current app URL conversion, persistence, reopen and identity tests passed')
