import { readHomeV2RetainedViewerBytes } from './v2/shell/home-v2-retained-viewer'

export async function readAndroidHomeV2ResourceCapability(
  value: string,
  maxBytes: number,
) {
  const url = new URL(value)
  const token = url.searchParams.get('qdnHomeStream')?.trim()
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.qdn.androidplatform.net') ||
    !token ||
    token.length > 256 ||
    value.length > 4_096
  ) {
    throw new Error('Android resource capability is invalid.')
  }
  const response = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  })
  return {
    bytes: await readHomeV2RetainedViewerBytes(response, maxBytes),
    contentType: response.headers.get('content-type') ?? undefined,
  }
}
