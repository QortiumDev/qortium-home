import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
let bundleSequence = 0
async function bundled(relative, plugins = []) {
  const outfile = path.join(root,'dist-electron',`current-url-fixture-${++bundleSequence}.mjs`)
  await build({entryPoints:[path.join(root,relative)],bundle:true,platform:'node',format:'esm',packages:'external',outfile,plugins})
  return import(pathToFileURL(outfile).href)
}
function productionFunction(relative, name, sandbox) {
  const file = path.join(root, relative), text = readFileSync(file,'utf8')
  const source = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const found=[]
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      assert.equal(node.initializer.expression.getText(source),'useCallback')
      found.push(node.initializer.arguments[0].getText(source))
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node.getText(source).replace(/^export /,''))
    ts.forEachChild(node,visit)
  }
  visit(source)
  assert.equal(found.length,1,`Find one real ${name}`)
  return vm.runInContext(ts.transpileModule(`(${found[0]})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,sandbox)
}
const helpers = await bundled('src/v2/current-app-location.ts')
const {createProductState,reduceProductState} = await bundled('src/v2/product-model.ts')
const {reduceTabNavigation} = await bundled('src/home-v2-live/tab-navigation.ts')
const {createHomeV2ShellState,serializeHomeV2ShellState,parseHomeV2ShellState} = await bundled('src/home-v2-live/shell-state.ts')
const {readHomeV2AppNavigationMessage} = await bundled('src/v2/app-frame-messages.ts')
const {parseAppResourceLocation} = await bundled('src/v2/resource-location.ts')
const {homeV2PermissionGrantKey} = await bundled('electron/home-v2-session-grants.ts')
const {savedEntryAccountId} = await bundled('src/v2/shell/account-context.ts')
const location = 'qortal://APP/Fixture/published/launch'
const context = {appId:'fixture',tabId:'fixture-tab',resourceLocation:location,sourceNetwork:'qortal',identityId:'home-v2:identity:wallet:B',walletRef:'home-v2:wallet:B'}
const app = {id:'fixture',title:'Fixture',sourceNetwork:'qortal',resourceIdentity:{service:'APP',name:'Fixture',identifier:'published'}}
const product = {current:reduceProductState(createProductState(),{type:'open-app',app,context,tabId:context.tabId})}
const actions=[], effects=[], saves=[]
const sandbox = vm.createContext({...helpers,productStateRef:product,savedEntryAccountId,URL,URLSearchParams,
  parseAppResourceLocation,
  dispatchProduct(action) {actions.push(action);product.current=reduceTabNavigation(product.current,action)},
  setAppNavigation(update) {sandbox.navigation=update(sandbox.navigation)},navigation:{},
  invalidateAndroidRuntime() {throw new Error('SPA navigation must not revoke grants')},
  window:{homeV2Apps:{invalidateRuntime(){throw new Error('SPA navigation must not revoke grants')}}},
  addDashboardPin(...args) {saves.push(['pin',...args])},
  applyCollectionsMutation(mutate) {return Promise.resolve({snapshot:mutate({})})},
  buildTabToolbarSave(_snapshot,entry) {saves.push(['toolbar',entry]);return {}},
  buildTabBookmarkToggle(_snapshot,entry) {saves.push(['bookmark',entry]);return {}},
  applyCollectionsSnapshot(){},setShellNotice(value){effects.push(value)},t:key=>key,internalTabLabelKeys:{},
})
Object.defineProperty(sandbox,'productState',{get:()=>product.current})
const shell='src/home-v2-live/HomeV2LiveApp.tsx'
const navigate=productionFunction(shell,'handleAppNavigationChanged',sandbox)
const address=productionFunction(shell,'tabAddress',sandbox)
const pin=productionFunction(shell,'pinTabToDashboard',sandbox)
const toolbar=productionFunction(shell,'dropTabOnBookmarkToolbar',sandbox)
const bookmark=productionFunction(shell,'toggleCurrentBookmark',sandbox)
const browserAddress=productionFunction('src/v2/shell/BrowserChrome.tsx','browserAddress',sandbox)
const wanted='qortal://APP/Fixture/published/page?room=2#end'
const render='https://node/render/APP/Fixture/published/launch?theme=dark'
const live='https://node/render/APP/Fixture/published/page?room=2&theme=dark#end'
const snapshot={resourceUrl:location,renderUrl:render,activeIndex:1,entries:[{index:0,url:render},{index:1,url:live}]}
const before=product.current.tabs[0].context
const grantContext = {appIdentity:location,tabId:context.tabId,action:'GET_USER_ACCOUNT',accountId:'wallet:B',
  accountUnlocked:true,nodeRoute:'qortal:fixture',principalId:41,protocol:'qortalRequest'}
const grant=homeV2PermissionGrantKey(grantContext)
navigate(context.tabId,snapshot)
assert.equal(browserAddress(product.current),wanted)
assert.equal(address(context.tabId).address,wanted)
await pin(context.tabId)
await toolbar(context.tabId)
await bookmark({displayUrl:browserAddress(product.current),title:'Fixture'})
assert.deepEqual(saves[0],['pin',wanted,'Fixture','wallet:B'])
assert.equal(saves[1][1].displayUrl,wanted)
assert.equal(saves[1][1].accountId,'wallet:B')
assert.equal(saves[2][1].displayUrl,wanted)
assert.equal(saves[2][1].accountId,'wallet:B')
assert.deepEqual(product.current.tabs[0].context,before)
assert.equal(homeV2PermissionGrantKey({...grantContext,appIdentity:product.current.tabs[0].context.resourceLocation}),grant)
const restored=parseHomeV2ShellState(serializeHomeV2ShellState({...createHomeV2ShellState('dark','en'),product:product.current}),'dark','en')
assert.equal(restored.product.tabs[0].context.resourceLocation,wanted)
assert.equal(restored.product.tabs[0].context.identityId,context.identityId)
const unchanged=product.current
navigate(context.tabId,{...snapshot,resourceUrl:'qortal://APP/Other/default'})
navigate('closed-tab',snapshot)
assert.equal(product.current,unchanged)
navigate(context.tabId,{...snapshot,entries:[{index:1,url:'https://node/render/APP/Other/published'}]})
assert.equal(product.current,unchanged)
// Back/forward read the active entry, not the last entry in history.
navigate(context.tabId,{...snapshot,activeIndex:0})
assert.equal(browserAddress(product.current),location)
// Android's authenticated relative-URL normalizer feeds the SAME callback.
const android=readHomeV2AppNavigationMessage({type:'qortium:qdn-navigation',bridgeToken:'test-token',activeIndex:0,entries:[{index:0,url:'/render/APP/Fixture/published/mobile?room=3&qdnHomeBridge=test-token#chat'}]},'test-token',render)
assert.ok(android)
navigate(context.tabId,{...android,resourceUrl:location,renderUrl:render})
assert.equal(browserAddress(product.current),'qortal://APP/Fixture/published/mobile?room=3#chat')
assert.deepEqual(effects,[])
const stage = 'src/v2/shell/AppTabStage.tsx'
const resolveRender = productionFunction(stage,'resolveRender',sandbox)
const renderInputs = productionFunction(stage,'homeV2AppStageRenderInputs',sandbox)
const appearance = {accent:'clay',resolvedLanguage:'en',textSize:'normal',resolvedTheme:'dark',ui:'standard'}
const nodeSnapshot = {appearance,nodes:{qortal:{capabilities:{read:true},nodeApiUrl:'https://node'}}}
const inputsBefore = renderInputs(unchanged,nodeSnapshot,0)
const inputsAfter = renderInputs(product.current,nodeSnapshot,0)
assert.deepEqual(inputsAfter,inputsBefore,'Current URL must not invalidate the active document memo')
assert.equal(new URL(resolveRender(product.current,nodeSnapshot).url).pathname,'/render/APP/Fixture/published/launch',
  'Desktop cached view keeps its original load request')
const androidResume = new URL(resolveRender(product.current,nodeSnapshot,true).url)
assert.equal(androidResume.pathname,'/render/APP/Fixture/published/mobile')
assert.equal(androidResume.hash,'#chat')
assert.equal(androidResume.searchParams.get('room'),'3')
assert.equal(androidResume.searchParams.has('qdnHomeBridge'),false,'Fresh proxy authorization does not reuse a saved token')

console.log('Production navigation, address/save callbacks, persisted resume, Android normalization/render and no-reload memo passed')
