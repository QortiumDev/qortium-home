import assert from 'node:assert/strict'
import {
  fetchHomeV2AvatarAction,
  type HomeV2AvatarActionDependencies,
  type HomeV2AvatarBinaryResult,
} from './home-v2-avatar-actions.js'

const address = 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH'
const owner = 'QH143K3FAiM4CHbm7cbYguCyYCdLMGW5YE'

function ready(
  body = 'iVBORw0KGgo=',
): Extract<HomeV2AvatarBinaryResult, { readonly status: 'ready' }> {
  return {
    body,
    contentLength: 8,
    contentType: 'image/png',
    status: 'ready',
  }
}

function fixture(
  json: Readonly<Record<string, { readonly data: unknown; readonly status: number }>>,
  avatar: HomeV2AvatarBinaryResult = ready(),
) {
  const jsonPaths: string[] = []
  const avatarPaths: Array<{ legacyAsync: boolean; path: string }> = []
  const dependencies: HomeV2AvatarActionDependencies = {
    async readAvatar(path, legacyAsync) {
      avatarPaths.push({ legacyAsync, path })
      return avatar
    },
    async readJson(path) {
      jsonPaths.push(path)
      return json[path] ?? { data: null, status: 404 }
    },
  }
  return { avatarPaths, dependencies, jsonPaths }
}

{
  const test = fixture({
    [`/addresses/${address}/avatar/info`]: {
      data: { identifier: 'account-v2', name: 'Alice', service: 'THUMBNAIL' },
      status: 200,
    },
  }, {
    ...ready(),
    descriptor: { identifier: 'new-pointer', name: 'New Alice', service: 'THUMBNAIL' },
  })
  assert.deepEqual(
    await fetchHomeV2AvatarAction(
      'qortium',
      'FETCH_ACCOUNT_AVATAR',
      { address },
      test.dependencies,
    ),
    {
      address,
      body: 'iVBORw0KGgo=',
      contentLength: 8,
      contentType: 'image/png',
      descriptor: { identifier: 'new-pointer', name: 'New Alice', service: 'THUMBNAIL' },
      encoding: 'base64',
      network: 'qortium',
      source: 'POINTER',
    },
  )
  assert.deepEqual(test.avatarPaths, [
    { legacyAsync: false, path: `/addresses/${address}/avatar` },
  ])
}

{
  const test = fixture({
    '/groups/12/avatar/info': {
      data: { identifier: 'group-v2', name: 'Owner', service: 'THUMBNAIL' },
      status: 200,
    },
  })
  const result = await fetchHomeV2AvatarAction(
    'qortium',
    'FETCH_GROUP_AVATAR',
    { groupId: '12' },
    test.dependencies,
  )
  assert.equal(result.network, 'qortium')
  assert.equal(result.groupId, 12)
  assert.equal(result.source, 'POINTER')
  assert.deepEqual(test.avatarPaths, [
    { legacyAsync: false, path: '/groups/12/avatar' },
  ])
}

{
  const test = fixture({
    [`/addresses/${address}/avatar/info`]: { data: null, status: 404 },
    [`/names/primary/${address}`]: { data: { name: 'Qortium Alice' }, status: 200 },
  })
  const result = await fetchHomeV2AvatarAction(
    'qortium',
    'FETCH_ACCOUNT_AVATAR',
    { address },
    test.dependencies,
  )
  assert.equal(result.source, 'LEGACY')
  assert.deepEqual(test.avatarPaths, [{
    legacyAsync: true,
    path: '/arbitrary/THUMBNAIL/Qortium%20Alice/avatar?async=true',
  }])
}

{
  const test = fixture({
    '/groups/12/avatar/info': { data: null, status: 404 },
    '/groups/12': {
      data: { groupId: 12, owner, ownerPrimaryName: 'Legacy Owner' },
      status: 200,
    },
  })
  const result = await fetchHomeV2AvatarAction(
    'qortium',
    'FETCH_GROUP_AVATAR',
    { groupId: 12 },
    test.dependencies,
  )
  assert.equal(result.source, 'LEGACY')
  assert.deepEqual(test.avatarPaths, [{
    legacyAsync: true,
    path: '/arbitrary/THUMBNAIL/Legacy%20Owner/qortal_group_avatar_12?async=true',
  }])
}

{
  const test = fixture({
    [`/names/primary/${address}`]: { data: { name: 'Alice' }, status: 200 },
  }, { retryAfterSeconds: 4, status: 'pending' })
  assert.deepEqual(
    await fetchHomeV2AvatarAction(
      'qortal',
      'FETCH_ACCOUNT_AVATAR',
      { address, maxBytes: 1_000 },
      test.dependencies,
    ),
    {
      address,
      descriptor: null,
      network: 'qortal',
      retryAfterSeconds: 4,
      source: 'LEGACY',
      status: 'PENDING',
    },
  )
  assert.deepEqual(test.jsonPaths, [`/names/primary/${address}`])
  assert.deepEqual(test.avatarPaths, [{
    legacyAsync: true,
    path: '/arbitrary/THUMBNAIL/Alice/qortal_avatar?async=true',
  }])
}

{
  const test = fixture({
    [`/names/primary/${address}`]: { data: null, status: 404 },
    [`/names/address/${address}?limit=0`]: { data: [{ name: 'Fallback' }], status: 200 },
  })
  const result = await fetchHomeV2AvatarAction(
    'qortal',
    'FETCH_ACCOUNT_AVATAR',
    { address },
    test.dependencies,
  )
  assert.equal(result.source, 'LEGACY')
  assert.deepEqual(test.avatarPaths, [{
    legacyAsync: true,
    path: '/arbitrary/THUMBNAIL/Fallback/qortal_avatar?async=true',
  }])
}

{
  const test = fixture({
    '/groups/12': {
      data: { groupId: 12, owner, ownerPrimaryName: 'Group Owner' },
      status: 200,
    },
  })
  const result = await fetchHomeV2AvatarAction(
    'qortal',
    'FETCH_GROUP_AVATAR',
    { groupId: 12 },
    test.dependencies,
  )
  assert.equal(result.network, 'qortal')
  assert.equal(result.source, 'LEGACY')
  assert.deepEqual(test.jsonPaths, ['/groups/12'])
  assert.deepEqual(test.avatarPaths, [{
    legacyAsync: true,
    path: '/arbitrary/THUMBNAIL/Group%20Owner/qortal_group_avatar_12?async=true',
  }])
}

{
  const test = fixture({
    '/groups/12': { data: { groupId: 12, owner }, status: 200 },
    [`/names/primary/${owner}`]: { data: null, status: 404 },
    [`/names/address/${owner}?limit=0`]: { data: [{ name: 'Older Owner' }], status: 200 },
  }, { status: 'missing' })
  const result = await fetchHomeV2AvatarAction(
    'qortal',
    'FETCH_GROUP_AVATAR',
    { txGroupId: 12 },
    test.dependencies,
  )
  assert.equal('status' in result, true)
  if (!('status' in result)) throw new Error('Expected a pending avatar result.')
  assert.equal(result.status, 'PENDING')
  assert.equal(result.retryAfterSeconds, 2)
  assert.deepEqual(test.avatarPaths, [{
    legacyAsync: true,
    path: '/arbitrary/THUMBNAIL/Older%20Owner/qortal_group_avatar_12?async=true',
  }])
}

{
  const test = fixture({
    [`/addresses/${address}/avatar/info`]: { data: null, status: 503 },
    [`/names/primary/${address}`]: { data: { name: 'Must not fall back' }, status: 200 },
  })
  await assert.rejects(
    () => fetchHomeV2AvatarAction(
      'qortium',
      'FETCH_ACCOUNT_AVATAR',
      { address },
      test.dependencies,
    ),
    /pointer lookup returned HTTP 503/,
  )
  assert.deepEqual(test.jsonPaths, [`/addresses/${address}/avatar/info`])
  assert.deepEqual(test.avatarPaths, [])
}

{
  const test = fixture({
    [`/names/primary/${address}`]: { data: { name: 'Alice' }, status: 200 },
  }, ready())
  await assert.rejects(
    () => fetchHomeV2AvatarAction(
      'qortal',
      'FETCH_ACCOUNT_AVATAR',
      { address, maxBytes: 4 },
      test.dependencies,
    ),
    /exceeded the requested size limit/,
  )
}

await assert.rejects(
  () => fetchHomeV2AvatarAction(
    'qortal',
    'FETCH_GROUP_AVATAR',
    { groupId: 0 },
    fixture({}).dependencies,
  ),
  /positive integer/,
)

{
  const test = fixture({
    [`/names/primary/${address}`]: { data: { name: '..' }, status: 200 },
  })
  await assert.rejects(
    () => fetchHomeV2AvatarAction(
      'qortal',
      'FETCH_ACCOUNT_AVATAR',
      { address },
      test.dependencies,
    ),
    /avatar name was invalid/,
  )
  assert.deepEqual(test.avatarPaths, [])
}

console.log('Home v2 avatar action tests passed.')
