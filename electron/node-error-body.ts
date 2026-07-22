// Shared handling for failed Qortium Core responses.
//
// Core reports API errors either with its own JSON envelope
// (`{"error":312,"message":"…"}`) or with a short plain-text reason such as
// `Bad parameter "name"`. Both are worth showing.
//
// Anything else is not. When Core raises an unhandled exception its
// ApiExceptionMapper falls through to an empty `serverError()`, and Jetty then
// renders its default HTML error page; a reverse proxy in front of a custom
// node can do the same. Forwarding that body verbatim drops raw markup into a
// Q-App's error UI instead of the purpose-specific message every caller already
// supplies. See QortiumDev/qortium-home#187, and QortiumDev/qortium-core#148 for
// a Core-side bug that currently produces exactly this.

/** Longer than any Core error message; past this a body is a document, not a message. */
export const MAX_NODE_ERROR_BODY_LENGTH = 2048;

/**
 * True when a response body looks like a markup document (HTML, XHTML, an XML
 * fault page).
 *
 * A leading `<` alone is not enough: a plain-text node message may legitimately
 * start with one, e.g. `<name> is already registered`. A real document also
 * opens with a declaration (`<!DOCTYPE`, `<?xml`) or closes a tag somewhere,
 * which a one-line message never does.
 */
export function isMarkupErrorBody(body: string) {
  const trimmed = body.trimStart();

  if (!trimmed.startsWith('<')) return false;

  return trimmed.startsWith('<!') || trimmed.startsWith('<?') || trimmed.includes('</');
}

/**
 * Picks the message to surface for a failed node response.
 *
 * Returns the trimmed body when it is plausibly a Core error message, and the
 * caller's fallback when the body is empty, markup-shaped, or too long to be a
 * message.
 */
export function readableNodeErrorMessage(body: string, fallbackMessage: string) {
  const trimmed = body.trim();

  if (!trimmed) return fallbackMessage;
  if (isMarkupErrorBody(trimmed)) return fallbackMessage;
  if (trimmed.length > MAX_NODE_ERROR_BODY_LENGTH) return fallbackMessage;

  return trimmed;
}
