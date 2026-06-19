import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Photo } from '../lib/types'
import { formatDate } from '../lib/format'
import { ensureDisplayableImage } from '../lib/heic'

const BUCKET = 'project-photos'
const SIGNED_URL_TTL = 60 * 60 // 60 minutes

interface Props {
  projectId: string
  phaseId: string
  benchmarkId: string
  takenBy: string | null
}

interface PhotoWithUrl extends Photo {
  url: string | null
}

export default function BenchmarkPhotos({
  projectId,
  phaseId,
  benchmarkId,
  takenBy,
}: Props) {
  const [photos, setPhotos] = useState<PhotoWithUrl[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close the lightbox on Esc.
  useEffect(() => {
    if (!lightboxUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  const load = useCallback(async () => {
    const { data, error: loadErr } = await supabase
      .from('photos')
      .select('*')
      .eq('benchmark_id', benchmarkId)
      .order('created_at', { ascending: true })

    if (loadErr) {
      setError(loadErr.message)
      return
    }

    const rows = (data ?? []) as Photo[]
    if (rows.length === 0) {
      setPhotos([])
      return
    }

    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(
        rows.map((r) => r.storage_path),
        SIGNED_URL_TTL,
      )

    const urlByPath = new Map(
      (signed ?? []).map((s) => [s.path ?? '', s.signedUrl]),
    )
    setPhotos(
      rows.map((r) => ({ ...r, url: urlByPath.get(r.storage_path) ?? null })),
    )
  }, [benchmarkId])

  useEffect(() => {
    load()
  }, [load])

  const onSelectFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    // Allow re-selecting the same file later.
    if (inputRef.current) inputRef.current.value = ''
    if (!selected) return

    setError(null)
    setUploading(true)
    try {
      // Convert iPhone HEIC/HEIF to JPEG so the thumbnail always renders.
      const file = await ensureDisplayableImage(selected)
      const path = `${projectId}/${benchmarkId}/${Date.now()}-${file.name}`

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        })
      if (uploadErr) throw uploadErr

      const { error: insertErr } = await supabase.from('photos').insert({
        project_id: projectId,
        phase_id: phaseId,
        benchmark_id: benchmarkId,
        storage_path: path,
        taken_by: takenBy,
      })
      if (insertErr) {
        // Roll back the orphaned upload so storage and DB stay consistent.
        await supabase.storage.from(BUCKET).remove([path])
        throw insertErr
      }

      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const onDelete = async (photo: PhotoWithUrl) => {
    setError(null)
    const { error: rmErr } = await supabase.storage
      .from(BUCKET)
      .remove([photo.storage_path])
    if (rmErr) {
      setError(rmErr.message)
      return
    }
    const { error: delErr } = await supabase
      .from('photos')
      .delete()
      .eq('id', photo.id)
    if (delErr) {
      setError(delErr.message)
      return
    }
    await load()
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p) => (
          <div key={p.id} className="flex flex-col items-center gap-1">
            <div className="relative">
              <button
                type="button"
                onClick={() => p.url && setLightboxUrl(p.url)}
                disabled={!p.url}
                className="block"
                aria-label="View photo"
              >
                {p.url ? (
                  <img
                    src={p.url}
                    alt="Benchmark photo"
                    className="h-14 w-14 rounded-lg border border-surfaceBorder object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-surfaceBorder bg-field text-[10px] text-muted">
                    …
                  </div>
                )}
              </button>
              <button
                type="button"
                aria-label="Delete photo"
                onClick={() => onDelete(p)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface text-danger shadow ring-1 ring-surfaceBorder hover:bg-danger/15"
              >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
              </button>
            </div>
            <span className="text-[10px] text-muted">
              {formatDate(p.created_at)}
            </span>
          </div>
        ))}

        {/* Add photo control */}
        <label className="flex h-11 min-w-[44px] cursor-pointer items-center gap-1.5 rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-charcoal transition hover:bg-white/5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 text-amber"
          >
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
          <span>{uploading ? 'Uploading…' : 'Add photo'}</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={uploading}
            onChange={onSelectFile}
          />
        </label>

        {photos.length > 1 && (
          <span className="text-xs text-muted">{photos.length} photos</span>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}

      {/* In-app lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface/90 text-charcoal shadow-lg hover:bg-surface"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
          <img
            src={lightboxUrl}
            alt="Benchmark photo"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
