import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ensureDisplayableImage } from '../lib/heic'
import wordmark from '../assets/benchmark_logo_darkmode.png'

const PHOTO_BUCKET = 'selection-photos'
const SIGNED_URL_TTL = 60 * 60
const TEXT_DEBOUNCE_MS = 800
const RETRY_MS = 2500
const SECTION_ORDER = ['Exterior', 'Interior', 'Final']

// ── Types (loose — the data comes from a jsonb RPC payload) ─────────────────
interface CatalogItem {
  id: string
  section: string
  sort_order: number
  label: string
  help: string | null
  qtype: 'radio' | 'text' | 'yesno' | string
  options: string[] | null
  upcharge_note: string | null
}

interface TokenProject {
  id: string
  name: string
  address: string | null
  client_email: string | null
}

interface Sel {
  value: string
  is_other: boolean
  is_na: boolean
  note: string
  image_url: string | null
}

const emptySel = (): Sel => ({
  value: '',
  is_other: false,
  is_na: false,
  note: '',
  image_url: null,
})

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g
const IS_URL_RE = /^https?:\/\//

/** Help text with any URLs turned into links that open in a new tab. */
function HelpText({ text }: { text: string }) {
  const parts = text.split(URL_SPLIT_RE)
  return (
    <p className="mt-1 text-sm text-muted">
      {parts.map((part, i) =>
        IS_URL_RE.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-700 underline underline-offset-2"
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

function isAnswered(s: Sel | undefined): boolean {
  if (!s) return false
  return s.is_na || s.value.trim() !== ''
}

export default function ClientSelections() {
  const { token } = useParams<{ token: string }>()

  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const [project, setProject] = useState<TokenProject | null>(null)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [selByCat, setSelByCat] = useState<Record<string, Sel>>({})
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')

  // Mirrors of state for use inside async/debounced callbacks (no stale reads).
  const selRef = useRef<Record<string, Sel>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const emailTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingCats = useRef<Set<string>>(new Set())
  const errorCats = useRef<Set<string>>(new Set())

  // Resolve a stored storage-path into a displayable URL (signed, else public).
  const resolveImageUrl = useCallback(async (path: string) => {
    const signed = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL)
    if (signed.data?.signedUrl) return signed.data.signedUrl
    return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
  }, [])

  // ── Initial load via the token RPC ────────────────────────────────────────
  useEffect(() => {
    let active = true
    if (!token) {
      setInvalid(true)
      setLoading(false)
      return
    }
    ;(async () => {
      const { data, error } = await supabase.rpc('get_project_by_token', {
        p_token: token,
      })
      if (!active) return
      if (error) {
        setLoadError(true)
        setLoading(false)
        return
      }
      if (!data) {
        setInvalid(true)
        setLoading(false)
        return
      }
      const payload = data as {
        project: TokenProject
        catalog: CatalogItem[]
        selections: Array<Sel & { category_id: string }>
      }
      setProject(payload.project)
      setEmail(payload.project?.client_email ?? '')
      setCatalog(payload.catalog ?? [])

      const map: Record<string, Sel> = {}
      for (const s of payload.selections ?? []) {
        map[s.category_id] = {
          value: s.value ?? '',
          is_other: !!s.is_other,
          is_na: !!s.is_na,
          note: s.note ?? '',
          image_url: s.image_url ?? null,
        }
      }
      selRef.current = map
      setSelByCat(map)
      setLoading(false)

      // Resolve thumbnails for any pre-existing photos.
      for (const [catId, s] of Object.entries(map)) {
        if (s.image_url) {
          resolveImageUrl(s.image_url).then((url) => {
            if (active && url) setPreviews((p) => ({ ...p, [catId]: url }))
          })
        }
      }
    })()
    return () => {
      active = false
    }
  }, [token, resolveImageUrl])

  // ── Save status bookkeeping ───────────────────────────────────────────────
  const scheduleIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      if (savingCats.current.size === 0 && errorCats.current.size === 0) {
        setStatus('idle')
      }
    }, 1500)
  }, [])

  const persistCategory = useCallback(
    async (catId: string) => {
      if (!token) return
      const s = selRef.current[catId]
      if (!s) return
      savingCats.current.add(catId)
      errorCats.current.delete(catId)
      setStatus('saving')

      const { error } = await supabase.rpc('save_selection', {
        p_token: token,
        p_category_id: catId,
        p_value: s.value.trim() ? s.value : null,
        p_is_other: s.is_other,
        p_is_na: s.is_na,
        p_note: s.note.trim() ? s.note : null,
        p_image_url: s.image_url,
      })

      savingCats.current.delete(catId)
      if (error) {
        // Never lose the typed value — retry the latest state shortly.
        errorCats.current.add(catId)
        setStatus('error')
        setTimeout(() => persistCategory(catId), RETRY_MS)
        return
      }
      errorCats.current.delete(catId)
      if (errorCats.current.size > 0) setStatus('error')
      else if (savingCats.current.size > 0) setStatus('saving')
      else {
        setStatus('saved')
        scheduleIdle()
      }
    },
    [token, scheduleIdle],
  )

  // Merge a patch into a category's selection, then save (debounced or now).
  const update = useCallback(
    (catId: string, patch: Partial<Sel>, immediate: boolean) => {
      const cur = selRef.current[catId] ?? emptySel()
      const merged = { ...cur, ...patch }
      selRef.current = { ...selRef.current, [catId]: merged }
      setSelByCat(selRef.current)

      if (timers.current[catId]) clearTimeout(timers.current[catId])
      if (immediate) {
        persistCategory(catId)
      } else {
        timers.current[catId] = setTimeout(
          () => persistCategory(catId),
          TEXT_DEBOUNCE_MS,
        )
      }
    },
    [persistCategory],
  )

  const onPhoto = useCallback(
    async (catId: string, file: File) => {
      if (!project) return
      setUploading((u) => ({ ...u, [catId]: true }))
      try {
        const img = await ensureDisplayableImage(file)
        const path = `${project.id}/${catId}/${Date.now()}-${img.name}`
        const { error: upErr } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, img, {
            contentType: img.type || 'image/jpeg',
            upsert: false,
          })
        if (upErr) {
          setStatus('error')
          return
        }
        // Instant local preview; persist the path via save_selection.
        setPreviews((p) => ({ ...p, [catId]: URL.createObjectURL(img) }))
        update(catId, { image_url: path }, true)
      } catch {
        setStatus('error')
      } finally {
        setUploading((u) => ({ ...u, [catId]: false }))
      }
    },
    [project, update],
  )

  // ── Email autosave ────────────────────────────────────────────────────────
  const saveEmail = useCallback(
    (value: string) => {
      if (!token) return
      supabase.rpc('save_client_email', {
        p_token: token,
        p_email: value.trim(),
      })
    },
    [token],
  )
  const onEmailChange = (value: string) => {
    setEmail(value)
    if (emailTimer.current) clearTimeout(emailTimer.current)
    emailTimer.current = setTimeout(() => saveEmail(value), TEXT_DEBOUNCE_MS)
  }
  const onEmailBlur = () => {
    if (emailTimer.current) clearTimeout(emailTimer.current)
    saveEmail(email)
  }

  // Clean up any pending timers on unmount.
  useEffect(
    () => () => {
      Object.values(timers.current).forEach(clearTimeout)
      if (emailTimer.current) clearTimeout(emailTimer.current)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    },
    [],
  )

  const sections = useMemo(() => {
    const bySection = new Map<string, CatalogItem[]>()
    for (const c of catalog) {
      const arr = bySection.get(c.section) ?? []
      arr.push(c)
      bySection.set(c.section, arr)
    }
    for (const arr of bySection.values()) {
      arr.sort((a, b) => a.sort_order - b.sort_order)
    }
    const ordered = [
      ...SECTION_ORDER.filter((s) => bySection.has(s)),
      ...[...bySection.keys()].filter((s) => !SECTION_ORDER.includes(s)),
    ]
    return ordered.map((name) => ({ name, items: bySection.get(name) ?? [] }))
  }, [catalog])

  const answeredCount = useMemo(
    () => catalog.reduce((n, c) => n + (isAnswered(selByCat[c.id]) ? 1 : 0), 0),
    [catalog, selByCat],
  )

  // ── Render states ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber border-t-transparent" />
      </div>
    )
  }

  if (invalid || loadError || !project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app px-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-charcoal">
            This link isn’t valid
          </h1>
          <p className="mt-2 text-sm text-muted">
            Please check the link your builder sent you, or ask them for a new
            one.
          </p>
        </div>
      </div>
    )
  }

  const statusLabel =
    status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? 'Saved'
        : status === 'error'
          ? 'Couldn’t save — retrying'
          : ''

  return (
    <div className="min-h-screen bg-app">
      {/* Branded sticky header with the live save indicator */}
      <header className="sticky top-0 z-10 border-b border-surfaceBorder bg-surface">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <img src={wordmark} alt="BenchMark" className="h-7 w-auto" />
          <span
            className={`text-xs font-medium transition ${
              status === 'error'
                ? 'text-danger'
                : status === 'idle'
                  ? 'text-transparent'
                  : 'text-muted'
            }`}
            aria-live="polite"
          >
            {statusLabel || '·'}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-2xl font-bold text-charcoal">Product Selections</h1>
        <p className="mt-1 text-ink">{project.name}</p>
        {project.address && (
          <p className="text-sm text-muted">{project.address}</p>
        )}

        {/* Editable email */}
        <div className="mt-4 rounded-2xl bg-surface p-4 shadow-sm">
          <label
            htmlFor="client-email"
            className="text-xs font-medium uppercase tracking-wide text-muted"
          >
            Your email
          </label>
          <input
            id="client-email"
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            onBlur={onEmailBlur}
            placeholder="you@example.com"
            className="mt-1.5 min-h-[48px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
          />
        </div>

        {/* Progress */}
        <p className="mt-4 text-sm font-medium text-muted">
          {answeredCount} of {catalog.length} selections complete
        </p>

        {/* Questions grouped by section */}
        <div className="mt-4 space-y-6">
          {sections.map((sec) => (
            <section key={sec.name}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-700">
                {sec.name}
              </h2>
              <div className="space-y-3">
                {sec.items.map((cat) => (
                  <QuestionCard
                    key={cat.id}
                    cat={cat}
                    sel={selByCat[cat.id] ?? emptySel()}
                    preview={previews[cat.id]}
                    uploading={!!uploading[cat.id]}
                    onUpdate={update}
                    onPhoto={onPhoto}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="py-8 text-center text-xs text-muted">
          Your choices save automatically.
        </p>
      </main>
    </div>
  )
}

// ── One question card ─────────────────────────────────────────────────────
function QuestionCard({
  cat,
  sel,
  preview,
  uploading,
  onUpdate,
  onPhoto,
}: {
  cat: CatalogItem
  sel: Sel
  preview: string | undefined
  uploading: boolean
  onUpdate: (catId: string, patch: Partial<Sel>, immediate: boolean) => void
  onPhoto: (catId: string, file: File) => void
}) {
  const disabled = sel.is_na

  const selectOption = (opt: string) =>
    onUpdate(cat.id, { value: opt, is_other: false, is_na: false }, true)

  const selectOther = () =>
    onUpdate(
      cat.id,
      { is_other: true, is_na: false, value: sel.is_other ? sel.value : '' },
      true,
    )

  const setYesNo = (v: 'yes' | 'no') =>
    onUpdate(cat.id, { value: v, is_other: false, is_na: false }, true)

  const toggleNA = () => {
    if (sel.is_na) {
      onUpdate(cat.id, { is_na: false }, true)
    } else {
      onUpdate(cat.id, { is_na: true, value: '', is_other: false }, true)
    }
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) onPhoto(cat.id, f)
  }

  // The Front door question shows a photo above each option; images map to the
  // options array by order. Other radio questions stay text-only.
  const doorImages = ['/doors/door_1.webp', '/doors/door_2.webp', '/doors/door_3.webp']
  const useDoorImages = cat.qtype === 'radio' && cat.label === 'Front door'

  return (
    <div
      className={`rounded-xl border border-surfaceBorder bg-surface p-4 shadow-sm transition ${
        disabled ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-charcoal">{cat.label}</h3>
          {cat.help && <HelpText text={cat.help} />}
          {cat.upcharge_note && (
            <p className="mt-1 text-xs italic text-muted">{cat.upcharge_note}</p>
          )}
        </div>
        <button
          type="button"
          aria-pressed={sel.is_na}
          onClick={toggleNA}
          className={`min-h-[44px] shrink-0 rounded-lg border px-3 text-xs font-semibold transition ${
            sel.is_na
              ? 'border-muted bg-muted/20 text-ink'
              : 'border-surfaceBorder text-muted hover:bg-white/5'
          }`}
        >
          N/A
        </button>
      </div>

      {/* Answer controls (hidden visual weight when N/A) */}
      {!disabled && (
        <div className="mt-3">
          {cat.qtype === 'radio' && useDoorImages && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(cat.options ?? []).map((opt, i) => {
                const active = !sel.is_other && sel.value === opt
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => selectOption(opt)}
                    className={`overflow-hidden rounded-xl border-2 text-left transition ${
                      active
                        ? 'border-amber bg-amber/10'
                        : 'border-surfaceBorder hover:bg-white/5'
                    }`}
                  >
                    {doorImages[i] && (
                      <img
                        src={doorImages[i]}
                        alt={opt}
                        className="aspect-square w-full object-cover"
                      />
                    )}
                    <span
                      className={`block px-2 py-2 text-sm font-medium ${
                        active ? 'text-amber-700' : 'text-ink'
                      }`}
                    >
                      {opt}
                    </span>
                  </button>
                )
              })}
              {/* "Other" kept as a tappable tile alongside the door images. */}
              <button
                type="button"
                onClick={selectOther}
                className={`flex min-h-[44px] items-center justify-center rounded-xl border-2 px-4 text-sm font-medium transition ${
                  sel.is_other
                    ? 'border-amber bg-amber/10 text-amber-700'
                    : 'border-surfaceBorder text-ink hover:bg-white/5'
                }`}
              >
                Other
              </button>
            </div>
          )}

          {cat.qtype === 'radio' && !useDoorImages && (
            <div className="flex flex-wrap gap-2">
              {(cat.options ?? []).map((opt) => {
                const active = !sel.is_other && sel.value === opt
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => selectOption(opt)}
                    className={`min-h-[44px] rounded-lg border px-4 text-sm font-medium transition ${
                      active
                        ? 'border-amber bg-amber/15 text-amber-700'
                        : 'border-surfaceBorder text-ink hover:bg-white/5'
                    }`}
                  >
                    {opt}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={selectOther}
                className={`min-h-[44px] rounded-lg border px-4 text-sm font-medium transition ${
                  sel.is_other
                    ? 'border-amber bg-amber/15 text-amber-700'
                    : 'border-surfaceBorder text-ink hover:bg-white/5'
                }`}
              >
                Other
              </button>
            </div>
          )}

          {cat.qtype === 'radio' && sel.is_other && (
            <input
              type="text"
              value={sel.value}
              autoFocus
              onChange={(e) =>
                onUpdate(cat.id, { value: e.target.value, is_other: true }, false)
              }
              placeholder="Tell us what you'd like"
              className="mt-2 min-h-[48px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
            />
          )}

          {cat.qtype === 'text' && (
            <input
              type="text"
              value={sel.value}
              onChange={(e) =>
                onUpdate(cat.id, { value: e.target.value, is_other: false }, false)
              }
              placeholder="Type your answer"
              className="min-h-[48px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
            />
          )}

          {cat.qtype === 'yesno' && (
            <div className="flex gap-2">
              {(['yes', 'no'] as const).map((v) => {
                const active = sel.value === v
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setYesNo(v)}
                    className={`min-h-[44px] flex-1 rounded-lg border px-4 text-sm font-medium capitalize transition ${
                      active
                        ? 'border-amber bg-amber/15 text-amber-700'
                        : 'border-surfaceBorder text-ink hover:bg-white/5'
                    }`}
                  >
                    {v}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Optional note (always available) */}
      <input
        type="text"
        value={sel.note}
        onChange={(e) => onUpdate(cat.id, { note: e.target.value }, false)}
        placeholder="Add a note (optional)"
        className="mt-3 min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-sm outline-none focus:border-amber focus:ring-1 focus:ring-amber"
      />

      {/* Optional photo */}
      <div className="mt-3 flex items-center gap-3">
        {preview && (
          <img
            src={preview}
            alt="Selection"
            className="h-16 w-16 rounded-lg border border-surfaceBorder object-cover"
          />
        )}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-charcoal transition hover:bg-white/5">
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
          <span>
            {uploading ? 'Uploading…' : preview ? 'Replace photo' : 'Add photo'}
          </span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={onFile}
          />
        </label>
      </div>
    </div>
  )
}
