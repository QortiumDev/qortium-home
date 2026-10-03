import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createXmrSendStore } from './home-v2-xmr-send-store.js'
import { HomeXmrCustody, withXmrSeed, type XmrDeps } from './home-v2-xmr-custody.js'
import type { XmrOwnerRecord } from './home-v2-xmr-owner-store.js'
import { runXmrSend, normalizeXmrSend, type XmrSendDeps, type XmrOperation } from './home-v2-xmr-send.js'
import { XMR_SEND_ROWS } from './xmr-send-contract.js'
const session = '11111111-1111-1111-1111-111111111111'
const route = { apiKey: 'synthetic', bindingId: 'bind', nodeApiUrl: 'http://127.0.0.1:12391', nodeRoute: 'local', revision: 'one', trusted: true, reason: null }
const address = '4'.repeat(95)
const input = { action: 'PREPARE_XMR_SEND', recipient: address, amount: '0.000000001000' }
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'xmr-home-send-'))
  let owner: XmrOwnerRecord | undefined, active = false
  let wallet = ''
  await withXmrSeed({ seed: Buffer.alloc(32, 1), addressIndex: 0, walletVersion: 1 }, async (_seed, id) => { wallet = id })
  const ops = new Map<string, XmrOperation>()
  const calls: string[] = [], prompts: { rows: readonly {label:string;value:string}[]; preparing?: boolean }[] = []
  const flags = { noAdmission: false, loseCommit: false, valid: true, badQuote: false, cancelReject: false, reorg: false, heldTombstone: false }
  const ready = () => ({ sessionId: session, walletId: wallet, state: 'READY', send: false, updatedAt: 1,
    wallet: { address, height: 10, targetHeight: 10, synced: true, balanceAtomic: '1000000', unlockedAtomic: '1000000', transactions: [] } })
  const manager = new HomeXmrCustody(async (_route, url, method, body, token) => {
    calls.push(url)
    const data = body ? JSON.parse(body) : {}
    const ok = (data: unknown) => ({ ok: true, status: 200, data })
    if (url.endsWith('capabilities')) return ok({ protocolVersion: 1, derivationVersion: 1, decimals: 12, enabled: true, platformSupported: true, network: 'mainnet', localCustodyOnly: true, send: true, sendProtocolVersion: 1, feePolicy: 'NATIVE_NORMAL' })
    if (url.endsWith('/session')) return ok(active ? ready() : {sessionId: null, walletId: null, state: 'IDLE'})
    if (url.endsWith('/activate')) { active = true; return ok(ready()) }
    assert.equal(token, session)
    if (url.endsWith('/wallet')) return ok(ready())
    if (url.endsWith('/deactivate')) { active = false; return ok({ sessionId: '22222222-2222-2222-2222-222222222222', walletId: null, state: 'CLOSING' }) }
    if (url.endsWith('/prepare')) {
      if (flags.noAdmission) return { ok: false, status: 503, data: {code:'XMR_SEND_ADMISSION_PENDING', durable:false} }
      ops.set(data.operationId, {operationId:data.operationId, state:'PREPARED', quoteDigest:'a'.repeat(64), address:data.address, amountAtomic:flags.badQuote?'2000':data.amountAtomic, feeAtomic:'100',txid:'b'.repeat(64),walletHeld:true,expiresAt:Date.now()+120000,confirmations:0,unlocked:false})
    }
    const id = method === 'GET' ? url.split('/').at(-1)! : data.operationId
    if (!ops.has(id) && url.endsWith('/cancel')) ops.set(id,{operationId:id,state:'CANCELLED',quoteDigest:null,address:null,amountAtomic:null,feeAtomic:null,txid:null,walletHeld:false,expiresAt:0,confirmations:0,unlocked:false})
    const op = ops.get(id)
    if (!op || (flags.cancelReject && url.endsWith('/cancel'))) return {ok:false,status:409,data:{code:'XMR_SEND_NOT_READY'}}
    if (url.endsWith('/cancel')) Object.assign(op,{state:'CANCELLED',quoteDigest:null,address:null,amountAtomic:null,feeAtomic:null,txid:null,walletHeld:false})
    if (url.endsWith('/commit')) {
      assert.equal(data.quoteDigest, op.quoteDigest)
      Object.assign(op,{state:'UNKNOWN',quoteDigest:null})
      if (flags.loseCommit) throw Error('SENSITIVE transport diagnostic')
    }
    if (flags.heldTombstone && url.endsWith('/reconcile') && op.state === 'CANCELLED') Object.assign(op,{walletHeld:false})
    const snapshot = {...op}
    if (flags.reorg && url.endsWith('/reconcile')) Object.assign(op,{state:'UNKNOWN',confirmations:0,unlocked:false,walletHeld:true})
    return ok(snapshot)
  }, {list:()=>owner?[owner]:[],get:()=>owner,put:r=>{owner=r},remove:()=>{owner=undefined}}, async()=>{}, 1)
  const d: XmrDeps = { action:'ACTIVATE_XMR_WALLET',request:{action:'ACTIVATE_XMR_WALLET'},accountId:'account',host:1,tab:'tab',resolveRoute:async()=>route,validate:()=>{if(!flags.valid)throw Error('changed')},consent:async()=>{},captureConsent:()=>()=>true,getSeed:()=>({seed:Buffer.alloc(32,1),walletVersion:1,addressIndex:0}) }
  await manager.run(d)
  const deps: XmrSendDeps = {...d,manager,store:createXmrSendStore(directory),app:'APP/Wallet',approve:async(rows,_handle,preparing)=>{prompts.push({rows,preparing})}}
  const run = (action: Parameters<typeof runXmrSend>[0], request: Record<string,unknown> = {}) => runXmrSend(action,{action,...request},deps)
  return { directory, flags, deps, ops, calls, prompts, run, close:()=>rmSync(directory,{recursive:true,force:true}) }
}
test('exact quote, separate approvals, durable lost-response recovery and no duplicate relay', async()=>{
 const f=await fixture();try {
  const q=await f.run('PREPARE_XMR_SEND',input); assert.equal(q.state,'PREPARED')
  const reservation=f.deps.store.get('account')!; assert.notEqual(q.handle,reservation.operation)
  f.flags.loseCommit=true
  const pending=await f.run('COMMIT_XMR_SEND',{handle:q.handle});assert.equal(pending.state,'STATUS_REQUIRED')
  const recovered=await f.run('GET_XMR_SEND_STATUS');assert.equal(recovered.state,'UNKNOWN')
  await f.run('COMMIT_XMR_SEND',{handle:q.handle});assert.equal(f.calls.filter(p=>p.endsWith('/commit')).length,1)
  assert.deepEqual(f.prompts.map(p=>p.preparing),[true,undefined]);assert.deepEqual(f.prompts[1].rows.map(r=>r.label),[...XMR_SEND_ROWS])
  assert.equal(f.prompts[1].rows.find(r=>r.label==='Fee')!.value,'0.000000000100 XMR')
  assert(!JSON.stringify(recovered).includes('quoteDigest'));assert(!JSON.stringify(recovered).includes(reservation.operation))
  assert(!readFileSync(path.join(f.directory,'home-v2-xmr-sends.json'),'utf8').includes(address))
 }finally{f.close()}
})
test('approval refusal or changed account never commits',async()=>{
 const f=await fixture();try{
  const q=await f.run('PREPARE_XMR_SEND',input)
  f.deps.approve=async()=>{f.flags.valid=false}
  await assert.rejects(f.run('COMMIT_XMR_SEND',{handle:q.handle}));assert.equal(f.calls.filter(p=>p.endsWith('/commit')).length,0)
 }finally{f.close()}
})
test('unadmitted preparation cancellation requires a Core durable tombstone',async()=>{
 const f=await fixture();try{
  f.flags.noAdmission=true;const q=await f.run('PREPARE_XMR_SEND',input);assert.equal(q.state,'STATUS_REQUIRED')
  const result=await f.run('CANCEL_XMR_SEND',{handle:q.handle});assert.equal(result.state,'CANCELLED')
  assert(!f.calls.includes('/crosschain/xmr/deactivate'));assert.equal((await f.run('GET_XMR_SEND_STATUS')).state,'CANCELLED')
  assert.equal(f.calls.filter(p=>p.endsWith('/prepare')).length,1)
 }finally{f.close()}
})
test('foreground same-app recovery transfers tab lease without granting relay',async()=>{
 const f=await fixture();try{
  const q=await f.run('PREPARE_XMR_SEND',input);f.deps.tab='new-tab'
  await assert.rejects(f.run('GET_XMR_SEND_STATUS',{passive:true}))
  assert.equal((await f.run('GET_XMR_SEND_STATUS')).handle,q.handle)
  f.deps.tab='tab';await assert.rejects(f.run('COMMIT_XMR_SEND',{handle:q.handle}))
  assert.equal(f.calls.filter(p=>p.endsWith('/commit')).length,0)
  f.deps.tab='new-tab';f.deps.app='APP/Other';await assert.rejects(f.run('GET_XMR_SEND_STATUS'))
 }finally{f.close()}
})
test('terminal operation in closed tab permits new preparation without exposing old payment',async()=>{
 const f=await fixture();try{
  const q=await f.run('PREPARE_XMR_SEND',input);await f.run('CANCEL_XMR_SEND',{handle:q.handle});f.deps.tab='new-tab';f.deps.app='APP/Other'
  const next=await f.run('PREPARE_XMR_SEND',input);assert.notEqual(next.handle,q.handle)
 }finally{f.close()}
})
test('mismatched quote never grants commit and corrupted local store fails closed',async()=>{
 const f=await fixture();try{
  f.flags.badQuote=true;const value=await f.run('PREPARE_XMR_SEND',input);assert.equal(value.state,'STATUS_REQUIRED')
  await assert.rejects(f.run('COMMIT_XMR_SEND',{handle:value.handle}));assert.equal(f.calls.filter(p=>p.endsWith('/commit')).length,0)
  writeFileSync(path.join(f.directory,'home-v2-xmr-sends.json'),'{corrupt');await assert.rejects(f.run('GET_XMR_SEND_STATUS'))
 }finally{f.close()}
})
test('reject app-supplied signing material, fee, coercion and oversized precision',()=>{
 for(const patch of [{fee:'1'},{amount:1},{amount:'0.0000000000001'},{amount:'01'},{amount:'0'},{operationId:'x'},{quoteDigest:'a'.repeat(64)}])assert.throws(()=>normalizeXmrSend('PREPARE_XMR_SEND',{...input,...patch}))
})

test('rejected cancellation cannot erase an unknown accepted relay',async()=>{
 const f=await fixture();try{
  const q=await f.run('PREPARE_XMR_SEND',input)
  const op=f.ops.values().next().value!; Object.assign(op,{state:'UNKNOWN',quoteDigest:null})
  f.flags.cancelReject=true
  const result=await f.run('CANCEL_XMR_SEND',{handle:q.handle});assert.equal(result.state,'UNKNOWN');assert.equal(result.walletHeld,true)
  assert.equal((await f.run('GET_XMR_SEND_STATUS')).state,'UNKNOWN')
 }finally{f.close()}
})
test('stale tab adoption cannot downgrade durable commit intent',async()=>{
 const f=await fixture();try{
  await f.run('PREPARE_XMR_SEND',input);const original=f.deps.store.get('account')!
  f.deps.store.put({...original,phase:'COMMITTING'},original.handle)
  assert.throws(()=>f.deps.store.put({...original,tab:'new-tab'},original.handle))
  assert.equal(f.deps.store.get('account')!.phase,'COMMITTING')
 }finally{f.close()}
})

test('a reorg during cross-app replacement never exposes the prior payment',async()=>{
 const f=await fixture();try{
  await f.run('PREPARE_XMR_SEND',input)
  Object.assign(f.ops.values().next().value!,{state:'CONFIRMED',quoteDigest:null,confirmations:10,unlocked:true,walletHeld:false})
  f.flags.reorg=true;f.deps.app='APP/Other';f.deps.tab='other-tab'
  await assert.rejects(f.run('PREPARE_XMR_SEND',input));assert.equal(f.prompts.length,1)
 }finally{f.close()}
})

test('held cancellation reconciles earlier reorg holds instead of stranding the wallet',async()=>{
 const f=await fixture();try{
  const q=await f.run('PREPARE_XMR_SEND',input);await f.run('CANCEL_XMR_SEND',{handle:q.handle})
  Object.assign(f.ops.values().next().value!,{walletHeld:true});f.flags.heldTombstone=true
  const result=await f.run('GET_XMR_SEND_STATUS');assert.equal(result.state,'CANCELLED');assert.equal(result.walletHeld,false)
  assert(f.calls.some(p=>p.endsWith('/reconcile')))
 }finally{f.close()}
})
