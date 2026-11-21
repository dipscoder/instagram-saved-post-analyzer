/**
 * Strips anything that looks like a credential from text before it reaches a log or the
 * UI. Applied on every error path: a server error sometimes echoes the request back, and
 * the request carried the account's access token.
 */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{16,}/g, 'sk-…')
    .replace(/Bearer\s+[A-Za-z0-9._\-]{16,}/gi, 'Bearer …')
    .replace(/eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, 'eyJ…');
}
