import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CatalogCategory, Selection } from '../lib/types'
import { formatDate } from '../lib/format'

const PHOTO_BUCKET = 'selection-photos'
const SIGNED_URL_TTL = 60 * 60 // 60 minutes
// Fallback poll cadence used only if the realtime channel errors/closes.
const FALLBACK_POLL_MS = 15000

// Fixed display order of the catalog sections.
const SECTION_ORDER = ['Exterior', 'Interior', 'Final']

interface Props {
  projectId: string
  shareToken: string | null
  clientEmail: string | null
  /** When inside a collapsible panel, the panel supplies the title. */
  embedded?: boolean
  /** Reports the live progress count to a parent (e.g. for a collapsed header). */
  onCount?: (answered: number, total: number) => void
}

// Split keeps the URL delimiters; the test below is non-global to stay stateless.
const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g
const IS_URL_RE = /^https?:\/\//

/** Render help text, turning any URLs into clickable links. */
function HelpText({ text }: { text: string }) {
  const parts = text.split(URL_SPLIT_RE)
  return (
    <p className="mt-1 text-xs text-muted">
      {parts.map((part, i) =>
        IS_URL_RE.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-700 underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  )
}

const QTYPE_LABEL: Record<string, string> = {
  radio: 'Choice',
  text: 'Text',
  yesno: 'Yes / No',
}

/** Whether a selection counts toward the progress total. */
function isAnswered(sel: Selection | undefined): boolean {
  if (!sel) return false
  if (sel.is_na) return true
  return !!sel.value && sel.value.trim() !== ''
}

/** Human-readable answer for a selection given its question type. */
function answerText(cat: CatalogCategory, sel: Selection): string {
  if (cat.qtype === 'yesno') {
    if (sel.value === 'yes') return 'Yes'
    if (sel.value === 'no') return 'No'
  }
  return sel.value ?? ''
}

export default function SelectionsTab({
  projectId,
  shareToken,
  clientEmail,
  embedded = false,
  onCount,
}: Props) {
  const [catalog, setCatalog] = useState<CatalogCategory[]>([])
  const [selByCategory, setSelByCategory] = useState<Record<string, Selection>>(
    {},
  )
  // Resolved (signed) display URLs keyed by the raw image_url.
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Share link + client email (Part B).
  const [email, setEmail] = useState(clientEmail ?? '')
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailSaved, setEmailSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  // Resolve a display URL for an image_url that may be a full URL or a path.
  const resolveImageUrls = useCallback(async (rows: Selection[]) => {
    const raw = rows
      .map((r) => r.image_url)
      .filter((u): u is string => !!u)
    if (raw.length === 0) {
      setImageUrls({})
      return
    }
    const map: Record<string, string> = {}
    const paths: string[] = []
    for (const u of raw) {
      if (/^https?:\/\//.test(u)) map[u] = u
      else paths.push(u)
    }
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL)
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) map[s.path] = s.signedUrl
      }
    }
    setImageUrls(map)
  }, [])

  const loadSelections = useCallback(async () => {
    const { data, error: selErr } = await supabase
      .from('selections')
      .select('*')
      .eq('project_id', projectId)
    if (selErr) {
      setError(selErr.message)
      return
    }
    const rows = (data ?? []) as Selection[]
    const map: Record<string, Selection> = {}
    for (const r of rows) map[r.category_id] = r
    setSelByCategory(map)
    await resolveImageUrls(rows)
  }, [projectId, resolveImageUrls])

  // Initial load: catalog + selections.
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      const [catRes] = await Promise.all([
        supabase
          .from('catalog_categories')
          .select('*')
          .order('sort_order', { ascending: true }),
        loadSelections(),
      ])
      if (!active) return
      if (catRes.error) setError(catRes.error.message)
      else setCatalog((catRes.data ?? []) as CatalogCategory[])
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [loadSelections])

  // Realtime: live-update answers as the client fills them in. If the channel
  // errors or closes, fall back to polling so the view never sits stale.
  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      if (pollTimer) return
      pollTimer = setInterval(() => {
        loadSelections()
      }, FALLBACK_POLL_MS)
    }
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }

    const channel = supabase
      .channel(`selections:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'selections',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          loadSelections()
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          stopPolling()
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          startPolling()
        }
      })

    return () => {
      stopPolling()
      supabase.removeChannel(channel)
    }
  }, [projectId, loadSelections])

  // Close lightbox on Esc.
  useEffect(() => {
    if (!lightboxUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  // Group catalog by section, honoring SECTION_ORDER then any extras.
  const sections = useMemo(() => {
    const bySection = new Map<string, CatalogCategory[]>()
    for (const c of catalog) {
      const arr = bySection.get(c.section) ?? []
      arr.push(c)
      bySection.set(c.section, arr)
    }
    const ordered: string[] = [
      ...SECTION_ORDER.filter((s) => bySection.has(s)),
      ...[...bySection.keys()].filter((s) => !SECTION_ORDER.includes(s)),
    ]
    return ordered.map((name) => ({
      name,
      items: bySection.get(name) ?? [],
    }))
  }, [catalog])

  const answeredCount = useMemo(
    () =>
      catalog.reduce(
        (n, c) => n + (isAnswered(selByCategory[c.id]) ? 1 : 0),
        0,
      ),
    [catalog, selByCategory],
  )

  const total = catalog.length || 31

  // Report progress upward (e.g. for a collapsed section header).
  useEffect(() => {
    onCount?.(answeredCount, total)
  }, [onCount, answeredCount, total])

  const shareUrl = shareToken
    ? `${window.location.origin}/s/${shareToken}`
    : null

  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCopy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy the link — copy it manually.')
    }
  }

  const onSaveEmail = async () => {
    setEmailSaving(true)
    setEmailSaved(false)
    setError(null)
    const { error: updErr } = await supabase
      .from('projects')
      .update({ client_email: email.trim() || null })
      .eq('id', projectId)
    setEmailSaving(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    setEmailSaved(true)
    setTimeout(() => setEmailSaved(false), 2000)
  }

  return (
    <section>
      {!embedded && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-charcoal">Selections</h2>
          <span className="rounded-full bg-amber/10 px-3 py-1 text-sm font-semibold text-amber-700">
            Selections: {answeredCount} / {total}
          </span>
        </div>
      )}

      {/* Share link + client email (Part B) */}
      <div className="mb-4 space-y-3 rounded-2xl bg-surface p-4 shadow-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Client share link
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-field px-3 py-2 text-sm text-ink">
              {shareUrl ?? 'No share link yet'}
            </code>
            <button
              type="button"
              onClick={onCopy}
              disabled={!shareUrl}
              className="min-h-[44px] rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </div>

        <div>
          <label
            htmlFor="client-email"
            className="text-xs font-medium uppercase tracking-wide text-muted"
          >
            Client email
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              id="client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
            />
            <button
              type="button"
              onClick={onSaveEmail}
              disabled={emailSaving}
              className="min-h-[44px] rounded-lg border border-surfaceBorder px-4 text-sm font-medium text-charcoal transition hover:bg-white/5 disabled:opacity-60"
            >
              {emailSaving ? 'Saving…' : emailSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        <p className="text-xs text-muted">
          Send this link to your client. They can fill out selections with no
          login; you'll see their choices here live.
        </p>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-5">
          {sections.map((sec) => (
            <div key={sec.name}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                {sec.name}
              </h3>
              <ul className="space-y-2">
                {sec.items.map((cat) => {
                  const sel = selByCategory[cat.id]
                  const answered = isAnswered(sel)
                  const imgUrl =
                    sel?.image_url ? imageUrls[sel.image_url] : undefined
                  return (
                    <li
                      key={cat.id}
                      className="rounded-xl border border-surfaceBorder bg-surface p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-medium text-charcoal">
                            {cat.label}
                          </h4>
                          {cat.help && <HelpText text={cat.help} />}
                          {cat.upcharge_note && (
                            <p className="mt-1 text-xs italic text-muted">
                              {cat.upcharge_note}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full border border-surfaceBorder px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {QTYPE_LABEL[cat.qtype] ?? cat.qtype}
                        </span>
                      </div>

                      {/* Client's current answer (read-only) */}
                      <div className="mt-3 rounded-lg bg-field px-3 py-2">
                        {sel?.is_na ? (
                          <span className="inline-block rounded bg-muted/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
                            N/A
                          </span>
                        ) : answered ? (
                          <p className="text-sm font-medium text-charcoal">
                            {answerText(cat, sel!)}
                            {sel!.is_other && (
                              <span className="ml-1 text-xs text-muted">
                                (Other)
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="text-sm italic text-muted">
                            No answer yet
                          </p>
                        )}

                        {sel?.note && (
                          <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-muted">
                            {sel.note}
                          </p>
                        )}

                        {sel?.image_url && (
                          <button
                            type="button"
                            onClick={() => imgUrl && setLightboxUrl(imgUrl)}
                            disabled={!imgUrl}
                            className="mt-2 block"
                            aria-label="View photo"
                          >
                            {imgUrl ? (
                              <img
                                src={imgUrl}
                                alt="Selection"
                                className="h-16 w-16 rounded-lg border border-surfaceBorder object-cover"
                              />
                            ) : (
                              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-surfaceBorder bg-surface text-[10px] text-muted">
                                …
                              </div>
                            )}
                          </button>
                        )}

                        {sel?.updated_at && answered && (
                          <p className="mt-1.5 text-[11px] text-muted">
                            Updated {formatDate(sel.updated_at)}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* In-app lightbox (matches the photo viewer) */}
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
            alt="Selection"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  )
}
