// Shared redaction: never leak secrets into logs, snapshots, or tool outputs.
const SECRET_QUERY = /([?&](token|code|api_key|apikey|secret|password|access_token|auth)=)[^&#]*/gi;

export function redactUrl(url: string): string {
  return url.replace(SECRET_QUERY, "$1[REDACTED]");
}

export function redactMessage(msg: string): string {
  return msg
    .replace(/(password\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?\S+/gi, "$1[REDACTED]");
}

export function truncate(msg: string, max = 1000): string {
  return msg.length > max ? msg.slice(0, max - 1) + "…" : msg;
}
