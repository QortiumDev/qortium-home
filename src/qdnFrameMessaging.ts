export function resolveQdnFrameMessageUrl(frameSrc: string | null, renderUrl: string) {
  return frameSrc ?? renderUrl;
}

export function getQdnFrameMessageOrigin(frameMessageUrl: string) {
  try {
    const origin = new URL(frameMessageUrl).origin;

    return origin === 'null' ? '*' : origin;
  } catch {
    return '*';
  }
}
