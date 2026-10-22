export function date(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not observed';
}
export function shortId(value: string): string { return value.slice(0, 8); }
export function human(value: string): string { return value.replaceAll('_', ' '); }
export function valueText(value: unknown): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(valueText).join(', ') : 'Empty returned list';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  const role = /^role:(\d+)$/.exec(text);
  return role ? ({ '40': 'Maintainers (40)', '30': 'Developers + Maintainers (30)', '0': 'No access (0)' }[role[1]!] ?? `Role ${role[1]}`) : text;
}
export function safeLink(value: string): string | undefined {
  try { const url = new URL(value); return url.origin === 'https://gitlab.com' && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export function stale(value: string | undefined): boolean { return Boolean(value && Date.now() - Date.parse(value) > STALE_AFTER_MS); }
