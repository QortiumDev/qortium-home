export function resolveQdnRequestContextActive(
  requestContextActive: boolean | undefined,
  suspended: boolean,
) {
  return requestContextActive ?? !suspended;
}

export function isQdnRequestContextCurrent(
  listenerActive: boolean,
  requestContextActive: boolean,
  requestFrame: unknown,
  currentFrame: unknown,
) {
  return listenerActive && requestContextActive && requestFrame === currentFrame;
}
