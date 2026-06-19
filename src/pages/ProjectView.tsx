import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'
import wordmark from '../assets/benchmark_logo_darkmode.png'

const PHOTO_BUCKET = 'project-photos'
const SIGNED_URL_TTL = 60 * 60

// ── Shapes from the get_project_view RPC (read-only, no financials) ─────────
interface ViewBenchmark {
  id: string
  name: string
  sequence_order: number
  completed: boolean
  completed_date: string | null
  not_applicable: boolean
  is_inspection: boolean
  is_procurement: boolean
}

interface ViewPhase {
  name: string
  sequence_order: number
  progress_pct: number | null
  status: string | null
  target_start: string | null
  target_end: string | null
  actual_start: string | null
  actual_end: string | null
  benchmarks: ViewBenchmark[]
}

interface ViewPhoto {
  storage_path: string
  benchmark_id: string | null
  created_at: string
}

interface ViewProject {
  name: string
  address: string | null
  type: string | null
  status: string | null
  status_note: string | null
  status_note_updated_at: string | null
  start_date: string | null
  target_completion_date: string | null
  completed_at: string | null
}

interface ViewPayload {
  project: ViewProject
  phases: ViewPhase[]
  photos: ViewPhoto[]
}

const TYPE_LABELS: Record<string, string> = {
  new_build: 'New Build',
  renovation: 'Renovation',
}

/** Small tap-to-enlarge thumbnails for a set of photos. */
function PhotoThumbs({
  photos,
  urlByPath,
  onOpen,
  className = '',
}: {
  photos: ViewPhoto[]
  urlByPath: Record<string, string>
  onOpen: (url: string) => void
  className?: string
}) {
  if (photos.length === 0) return null
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {photos.map((photo, i) => {
        const url = urlByPath[photo.storage_path]
        if (!url) return null
        return (
          <button
            key={i}
            type="button"
            onClick={() => onOpen(url)}
            className="block overflow-hidden rounded-lg border border-surfaceBorder"
            aria-label="View photo"
          >
            <img
              src={url}
              alt="Project"
              loading="lazy"
              className="h-16 w-16 object-cover"
            />
          </button>
        )
      })}
    </div>
  )
}

function PhaseCard({
  phase,
  photosByBenchmark,
  urlByPath,
  onOpen,
}: {
  phase: ViewPhase
  photosByBenchmark: Map<string, ViewPhoto[]>
  urlByPath: Record<string, string>
  onOpen: (url: string) => void
}) {
  const [open, setOpen] = useState(false)
  const pct = Math.min(100, Math.max(0, Math.round(phase.progress_pct ?? 0)))
  // Total photos across this phase's benchmarks — used as a collapsed-state cue.
  const photoCount = phase.benchmarks.reduce(
    (n, b) => n + (photosByBenchmark.get(b.id)?.length ?? 0),
    0,
  )
  return (
    <div className="overflow-hidden rounded-xl border border-surfaceBorder bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-start gap-3 p-4 text-left"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`mt-1 h-5 w-5 shrink-0 text-muted transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 font-semibold text-charcoal">
              {phase.name}
            </h3>
            {phase.status && (
              <span className="mt-0.5 shrink-0 text-xs capitalize text-muted">
                {phase.status.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-full bg-amber transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-xs font-medium text-muted">
              {pct}%
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {formatDate(phase.target_start)} → {formatDate(phase.target_end)}
          </p>
          {/* When collapsed, hint that there are photos inside to tap open. */}
          {!open && photoCount > 0 && (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber/10 px-2 py-0.5 text-xs font-medium text-amber-700">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
                aria-hidden
              >
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
              {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
            </span>
          )}
        </div>
      </button>

      <div
        className={`grid transition-all duration-200 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <ul className="divide-y divide-surfaceBorder/60 border-t border-surfaceBorder/60">
            {phase.benchmarks.length === 0 && (
              <li className="px-4 py-3 text-sm text-muted">No items.</li>
            )}
            {[...phase.benchmarks]
              .sort((a, b) => a.sequence_order - b.sequence_order)
              .map((b, i) => {
                const isNA = b.not_applicable
                return (
                  <li
                    key={i}
                    className={`flex items-start gap-3 px-4 py-3 ${
                      isNA ? 'opacity-60' : ''
                    }`}
                  >
                    {/* Read-only status dot (no checkbox) */}
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                        b.completed
                          ? 'bg-success/20 text-success'
                          : 'border border-surfaceBorder text-transparent'
                      }`}
                      aria-hidden
                    >
                      ✓
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            b.completed
                              ? 'text-muted line-through'
                              : isNA
                                ? 'text-muted'
                                : b.is_procurement
                                  ? 'font-medium'
                                  : 'text-charcoal'
                          }
                          style={
                            b.is_procurement && !b.completed && !isNA
                              ? { color: '#6BA8E5' }
                              : undefined
                          }
                        >
                          {b.name}
                        </span>
                        {isNA && (
                          <span className="rounded bg-muted/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                            N/A
                          </span>
                        )}
                        {b.is_inspection && (
                          <span className="rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                            Inspection
                          </span>
                        )}
                      </div>
                      {b.completed && b.completed_date && (
                        <p className="mt-1 text-xs text-muted">
                          Done {formatDate(b.completed_date)}
                        </p>
                      )}
                      <PhotoThumbs
                        photos={photosByBenchmark.get(b.id) ?? []}
                        urlByPath={urlByPath}
                        onOpen={onOpen}
                        className="mt-2"
                      />
                    </div>
                  </li>
                )
              })}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default function ProjectView() {
  const { token } = useParams<{ token: string }>()

  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [data, setData] = useState<ViewPayload | null>(null)
  const [urlByPath, setUrlByPath] = useState<Record<string, string>>({})
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Resolve each storage path to a displayable URL (signed, else public).
  const resolvePhotoUrls = useCallback(async (photos: ViewPhoto[]) => {
    const paths = photos.map((p) => p.storage_path).filter(Boolean)
    if (paths.length === 0) {
      setUrlByPath({})
      return
    }
    const { data: signed } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL)
    const byPath = new Map(
      (signed ?? []).map((s) => [s.path ?? '', s.signedUrl]),
    )
    const map: Record<string, string> = {}
    for (const p of paths) {
      const s = byPath.get(p)
      map[p] = s ?? supabase.storage.from(PHOTO_BUCKET).getPublicUrl(p).data.publicUrl
    }
    setUrlByPath(map)
  }, [])

  useEffect(() => {
    let active = true
    if (!token) {
      setInvalid(true)
      setLoading(false)
      return
    }
    ;(async () => {
      const { data: res, error } = await supabase.rpc('get_project_view', {
        p_token: token,
      })
      if (!active) return
      if (error || !res) {
        setInvalid(true)
        setLoading(false)
        return
      }
      const payload = res as ViewPayload
      setData(payload)
      setLoading(false)
      resolvePhotoUrls(payload.photos ?? [])
    })()
    return () => {
      active = false
    }
  }, [token, resolvePhotoUrls])

  // Close lightbox on Esc.
  useEffect(() => {
    if (!lightboxUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  const overall = useMemo(() => {
    const phases = data?.phases ?? []
    if (phases.length === 0) return 0
    const sum = phases.reduce((n, p) => n + (p.progress_pct ?? 0), 0)
    return Math.round(sum / phases.length)
  }, [data])

  // Group photos by benchmark id; collect any null/unmatched ones for "Other".
  const { photosByBenchmark, otherPhotos } = useMemo(() => {
    const byBench = new Map<string, ViewPhoto[]>()
    const other: ViewPhoto[] = []
    const benchmarkIds = new Set<string>()
    for (const phase of data?.phases ?? []) {
      for (const b of phase.benchmarks) benchmarkIds.add(b.id)
    }
    for (const photo of data?.photos ?? []) {
      if (photo.benchmark_id && benchmarkIds.has(photo.benchmark_id)) {
        const arr = byBench.get(photo.benchmark_id) ?? []
        arr.push(photo)
        byBench.set(photo.benchmark_id, arr)
      } else {
        other.push(photo)
      }
    }
    return { photosByBenchmark: byBench, otherPhotos: other }
  }, [data])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber border-t-transparent" />
      </div>
    )
  }

  if (invalid || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app px-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-charcoal">
            This link isn’t valid or has been turned off
          </h1>
          <p className="mt-2 text-sm text-muted">
            Please check the link, or ask your builder for a new one.
          </p>
        </div>
      </div>
    )
  }

  const p = data.project
  const isComplete = p.status === 'complete'

  return (
    <div className="min-h-screen bg-app">
      {/* Branded header */}
      <header className="sticky top-0 z-10 border-b border-surfaceBorder bg-surface">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4">
          <img src={wordmark} alt="BenchMark" className="h-7 w-auto" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {/* Summary */}
        <div className="rounded-2xl bg-surface p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold leading-tight text-charcoal">
              {p.name}
            </h1>
            {p.type && (
              <span className="shrink-0 rounded-full border border-surfaceBorder px-2.5 py-1 text-xs font-medium text-muted">
                {TYPE_LABELS[p.type] ?? p.type}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isComplete ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                Completed {formatDate(p.completed_at)}
              </span>
            ) : (
              p.status && (
                <span className="rounded-full bg-amber/10 px-2.5 py-1 text-xs font-medium capitalize text-amber-700">
                  {p.status.replace(/_/g, ' ')}
                </span>
              )
            )}
          </div>

          {p.address && <p className="mt-3 text-sm text-muted">{p.address}</p>}

          {/* Status note */}
          {p.status_note && (
            <div className="mt-4 rounded-lg border-l-4 border-accent bg-accent/10 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">
                Status
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm font-medium text-ink">
                {p.status_note}
              </p>
              {p.status_note_updated_at && (
                <p className="mt-1 text-[11px] text-muted">
                  Updated {formatDate(p.status_note_updated_at)}
                </p>
              )}
            </div>
          )}

          {/* Overall progress */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted">
                Overall progress
              </span>
              <span className="text-lg font-bold text-charcoal">{overall}%</span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${overall}%` }}
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Start
              </p>
              <p className="mt-0.5 font-medium text-charcoal">
                {formatDate(p.start_date)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {isComplete ? 'Completed' : 'Target completion'}
              </p>
              <p className="mt-0.5 font-medium text-charcoal">
                {formatDate(isComplete ? p.completed_at : p.target_completion_date)}
              </p>
            </div>
          </div>
        </div>

        {/* Phases */}
        <h2 className="mb-3 mt-6 text-xl font-semibold text-charcoal">Phases</h2>
        <div className="space-y-3">
          {[...data.phases]
            .sort((a, b) => a.sequence_order - b.sequence_order)
            .map((phase, i) => (
              <PhaseCard
                key={i}
                phase={phase}
                photosByBenchmark={photosByBenchmark}
                urlByPath={urlByPath}
                onOpen={setLightboxUrl}
              />
            ))}
        </div>

        {/* Other photos — not tagged to a benchmark, so nothing is hidden. */}
        {otherPhotos.length > 0 && (
          <>
            <h2 className="mb-3 mt-6 text-xl font-semibold text-charcoal">
              Other photos
            </h2>
            <PhotoThumbs
              photos={otherPhotos}
              urlByPath={urlByPath}
              onOpen={setLightboxUrl}
            />
          </>
        )}

        <p className="py-8 text-center text-xs text-muted">
          Shared progress view — read only.
        </p>
      </main>

      {/* Lightbox */}
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
            alt="Project"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
