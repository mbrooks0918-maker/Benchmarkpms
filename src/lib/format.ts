/**
 * Compact, consistent date label, e.g. "Jun 10, 2026".
 * Accepts date-only strings ("YYYY-MM-DD") and full timestamps.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  // Anchor bare dates to local midnight so they don't shift across time zones.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Whole days elapsed between now and the given date (null if unparseable). */
export function daysSince(value: string | null | undefined): number | null {
  if (!value) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}
