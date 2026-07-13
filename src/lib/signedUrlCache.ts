import { supabase } from './supabase'

interface Cached {
  url: string
  expiresAt: number // epoch ms when the signed URL expires
}

// Per (bucket + storage_path) cache of signed URLs. Reusing the SAME url string
// across opens lets the browser/CDN cache the file bytes — re-opening a document
// is then a cache hit (0 storage egress) instead of a fresh, cache-busting URL.
const cache = new Map<string, Cached>()

const RENEW_MARGIN_MS = 5 * 60 * 1000 // renew when within 5 min of expiry

/**
 * Get a signed URL for a storage object, reusing a cached one when it's still
 * comfortably valid. `ttlSeconds` is used both for the signing request and to
 * track expiry. Returns null if signing fails.
 */
export async function getCachedSignedUrl(
  bucket: string,
  path: string,
  ttlSeconds: number,
): Promise<string | null> {
  const key = `${bucket}:${path}`
  const hit = cache.get(key)
  if (hit && hit.expiresAt - Date.now() > RENEW_MARGIN_MS) {
    return hit.url
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttlSeconds)
  if (error || !data?.signedUrl) return null

  cache.set(key, {
    url: data.signedUrl,
    expiresAt: Date.now() + ttlSeconds * 1000,
  })
  return data.signedUrl
}
