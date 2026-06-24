import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'
import { useOrgRole } from '../lib/useOrgRole'
import type { ChangeOrder, Draw, Phase, Project } from '../lib/types'

const BUCKET = 'project-docs'
const SIGNED_URL_TTL = 60 * 60 // 60 minutes

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

// "+$5,000" for an add, "-$5,000" for a credit, "$0" for zero.
function formatSigned(amount: number): string {
  if (amount === 0) return usd.format(0)
  const sign = amount < 0 ? '-' : '+'
  return `${sign}${usd.format(Math.abs(amount))}`
}

const ACCEPT = [
  'application/pdf',
  '.pdf',
  'image/*',
  '.heic',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
].join(',')

function todayISO(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

interface Props {
  project: Project
  phases: Phase[]
  draws: Draw[]
  createdBy: string | null
  /** Refresh the parent screen (contract breakdown, draws, reconciliation, docs). */
  onChanged: () => void | Promise<void>
  /** When inside a collapsible panel, the panel supplies the title. */
  embedded?: boolean
}

interface DocRef {
  storage_path: string
  file_name: string
}

export default function ChangeOrders({
  project,
  phases,
  draws,
  createdBy,
  onChanged,
  embedded = false,
}: Props) {
  const projectId = project.id
  const { isOwner } = useOrgRole()

  const [cos, setCos] = useState<ChangeOrder[]>([])
  const [docById, setDocById] = useState<Record<string, DocRef>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const signUrl = (tk: string) => `${window.location.origin}/sign/${tk}`

  const [showForm, setShowForm] = useState(false)
  const [coNumber, setCoNumber] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [phaseId, setPhaseId] = useState<string>('')
  const [coDate, setCoDate] = useState(todayISO())
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const phaseName = useCallback(
    (id: string | null) =>
      (id && phases.find((p) => p.id === id)?.name) || '—',
    [phases],
  )

  const load = useCallback(async () => {
    const { data, error: loadErr } = await supabase
      .from('change_orders')
      .select('*')
      .eq('project_id', projectId)
      .order('co_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (loadErr) {
      setError(loadErr.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as ChangeOrder[]
    setCos(rows)

    // Resolve attached documents (storage_path + name) for "View" links.
    const docIds = rows
      .map((r) => r.document_id)
      .filter((id): id is string => !!id)
    if (docIds.length > 0) {
      const { data: docs } = await supabase
        .from('documents')
        .select('id, storage_path, file_name')
        .in('id', docIds)
      const map: Record<string, DocRef> = {}
      for (const d of docs ?? []) {
        map[d.id] = { storage_path: d.storage_path, file_name: d.file_name }
      }
      setDocById(map)
    } else {
      setDocById({})
    }

    setLoading(false)
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (file) setPendingFile(file)
  }

  const resetForm = () => {
    setCoNumber('')
    setDescription('')
    setAmount('')
    setPhaseId('')
    setCoDate(todayISO())
    setPendingFile(null)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const amt = Number(amount)
    if (!amount.trim() || Number.isNaN(amt)) {
      setError('Enter an amount (use a negative number for a credit).')
      return
    }
    setSubmitting(true)
    setError(null)
    setNote(null)

    try {
      // 1. Optional signed-CO upload → documents row (category 'Contract').
      let documentId: string | null = null
      let uploadedPath: string | null = null
      if (pendingFile) {
        const path = `${projectId}/${Date.now()}-${pendingFile.name}`
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, pendingFile, {
            contentType: pendingFile.type || 'application/octet-stream',
            upsert: false,
          })
        if (upErr) throw upErr
        uploadedPath = path

        const { data: docRow, error: docErr } = await supabase
          .from('documents')
          .insert({
            project_id: projectId,
            category: 'Contract',
            file_name: pendingFile.name,
            storage_path: path,
            file_size: pendingFile.size,
            mime_type: pendingFile.type || null,
            uploaded_by: createdBy,
          })
          .select('id')
          .single()
        if (docErr) {
          await supabase.storage.from(BUCKET).remove([path])
          throw docErr
        }
        documentId = docRow.id as string
      }

      // 2. Insert the change order.
      const { error: coErr } = await supabase.from('change_orders').insert({
        project_id: projectId,
        phase_id: phaseId || null,
        co_number: coNumber.trim() || null,
        description: description.trim() || null,
        amount: amt,
        co_date: coDate || null,
        document_id: documentId,
        created_by: createdBy,
      })
      if (coErr) {
        if (uploadedPath) await supabase.storage.from(BUCKET).remove([uploadedPath])
        throw coErr
      }

      // 3 + 4. Capture the original baseline (once) and bump the current total.
      const newOriginal = project.original_amount ?? project.total_amount ?? 0
      const newTotal = (project.total_amount ?? 0) + amt
      const { error: projErr } = await supabase
        .from('projects')
        .update({ original_amount: newOriginal, total_amount: newTotal })
        .eq('id', projectId)
      if (projErr) throw projErr

      // 5. Draw adjustment on the affected phase (fixed-dollar only).
      let reviewNote: string | null = null
      const phaseDraw = draws.find(
        (d) => d.phase_id === phaseId && !d.benchmark_id,
      )
      if (phaseId && phaseDraw && phaseDraw.amount_type === 'fixed') {
        const { error: drawErr } = await supabase
          .from('draws')
          .update({ amount_value: (phaseDraw.amount_value ?? 0) + amt })
          .eq('id', phaseDraw.id)
        if (drawErr) throw drawErr
      } else {
        reviewNote = `Review the draw on ${phaseName(
          phaseId || null,
        )} — it wasn't auto-adjusted (percent-based or none set).`
      }

      resetForm()
      setShowForm(false)
      setNote(reviewNote)
      // 6. Refresh parent + our own list.
      await onChanged()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save change order.')
    } finally {
      setSubmitting(false)
    }
  }

  const onViewDoc = async (documentId: string) => {
    const ref = docById[documentId]
    if (!ref) return
    setError(null)
    const { data, error: urlErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(ref.storage_path, SIGNED_URL_TTL)
    if (urlErr || !data?.signedUrl) {
      setError(urlErr?.message ?? 'Could not open document.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const onDelete = async (co: ChangeOrder) => {
    if (
      !window.confirm(
        `Delete change order ${co.co_number ?? ''}? This reverses its ${formatSigned(
          co.amount,
        )} from the contract.`,
      )
    )
      return
    setError(null)
    setNote(null)

    // Reverse the contract bump.
    const newTotal = (project.total_amount ?? 0) - co.amount
    const { error: projErr } = await supabase
      .from('projects')
      .update({ total_amount: newTotal })
      .eq('id', projectId)
    if (projErr) {
      setError(projErr.message)
      return
    }

    // Reverse the fixed-draw bump, if that draw still exists.
    const phaseDraw = draws.find(
      (d) => d.phase_id === co.phase_id && !d.benchmark_id,
    )
    if (phaseDraw && phaseDraw.amount_type === 'fixed') {
      await supabase
        .from('draws')
        .update({ amount_value: (phaseDraw.amount_value ?? 0) - co.amount })
        .eq('id', phaseDraw.id)
    }

    const { error: delErr } = await supabase
      .from('change_orders')
      .delete()
      .eq('id', co.id)
    if (delErr) {
      setError(delErr.message)
      return
    }

    await onChanged()
    await load()
  }

  // Owner generates a public signing link by setting a random sign_token.
  const onGenerateLink = async (co: ChangeOrder) => {
    setError(null)
    const token = crypto.randomUUID().replace(/-/g, '')
    const { error: updErr } = await supabase
      .from('change_orders')
      .update({ sign_token: token })
      .eq('id', co.id)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await load()
  }

  const onCopyLink = async (co: ChangeOrder) => {
    if (!co.sign_token) return
    try {
      await navigator.clipboard.writeText(signUrl(co.sign_token))
      setCopiedId(co.id)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopiedId(null), 2000)
    } catch {
      setError('Could not copy — copy the link manually.')
    }
  }

  const onVoid = async (co: ChangeOrder) => {
    if (!window.confirm('Void this signed change order?')) return
    setError(null)
    const { error: updErr } = await supabase
      .from('change_orders')
      .update({ voided: true })
      .eq('id', co.id)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await load()
  }

  // Placeholder — wired up in the next step (signed-PDF generation).
  const downloadSignedCO = (_co: ChangeOrder) => {
    // TODO: generate & download the signed change-order PDF.
  }

  const inputClass =
    'min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber'

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        {!embedded && (
          <h2 className="text-xl font-semibold text-charcoal">Change Orders</h2>
        )}
        <button
          type="button"
          onClick={() => {
            setNote(null)
            setShowForm(true)
          }}
          className="min-h-[40px] rounded-lg bg-amber px-3 text-sm font-medium text-white transition hover:bg-amber-700"
        >
          + Add change order
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {note && (
        <p className="mb-3 rounded-lg bg-amber/10 px-3 py-2 text-sm text-amber-700">
          {note}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      ) : cos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surfaceBorder bg-surface/40 p-6 text-center">
          <p className="text-sm text-muted">No change orders yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-surfaceBorder/60 rounded-xl border border-surfaceBorder bg-surface shadow-sm">
          {cos.map((co) => (
            <li key={co.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {co.co_number && (
                    <span className="rounded bg-field px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      CO {co.co_number}
                    </span>
                  )}
                  <span
                    className={`text-sm font-semibold ${
                      co.amount < 0 ? 'text-danger' : 'text-charcoal'
                    }`}
                  >
                    {formatSigned(co.amount)}
                  </span>
                </div>
                {co.description && (
                  <p className="mt-1 text-sm text-charcoal">{co.description}</p>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{phaseName(co.phase_id)}</span>
                  <span>·</span>
                  <span>{formatDate(co.co_date)}</span>
                  {co.document_id && docById[co.document_id] && (
                    <>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() => onViewDoc(co.document_id as string)}
                        className="font-medium text-amber-700 hover:underline"
                      >
                        Signed CO
                      </button>
                    </>
                  )}
                </div>

                {/* E-signing status + controls */}
                <div className="mt-2">
                  {co.voided ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted/20 px-2.5 py-0.5 text-xs font-medium text-muted">
                      Voided
                    </span>
                  ) : co.signed_at ? (
                    <div className="space-y-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3.5 w-3.5"
                          aria-hidden
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        Signed{co.signed_name ? ` by ${co.signed_name}` : ''} on{' '}
                        {formatDate(co.signed_at)}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled
                          onClick={() => downloadSignedCO(co)}
                          className="min-h-[40px] rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-charcoal transition hover:bg-white/5 disabled:opacity-50"
                        >
                          Download signed PDF
                        </button>
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => onVoid(co)}
                            className="min-h-[40px] rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-danger transition hover:bg-danger/10"
                          >
                            Void
                          </button>
                        )}
                      </div>
                    </div>
                  ) : co.sign_token ? (
                    <div className="space-y-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber/10 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                        Awaiting signature
                      </span>
                      {isOwner && (
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="min-w-0 flex-1 truncate rounded-lg bg-field px-3 py-2 text-xs text-ink">
                            {signUrl(co.sign_token)}
                          </code>
                          <button
                            type="button"
                            onClick={() => onCopyLink(co)}
                            className="min-h-[40px] rounded-lg bg-amber px-3 text-sm font-medium text-white transition hover:bg-amber-700"
                          >
                            {copiedId === co.id ? 'Copied!' : 'Copy link'}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    isOwner && (
                      <button
                        type="button"
                        onClick={() => onGenerateLink(co)}
                        className="min-h-[40px] rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-amber-700 transition hover:bg-amber/5"
                      >
                        Generate signing link
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Signed/voided COs are locked; otherwise allow delete. */}
              {co.signed_at || co.voided ? (
                <span
                  title="Signed — locked from edits"
                  className="flex h-10 w-10 shrink-0 items-center justify-center text-muted"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                    aria-hidden
                  >
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onDelete(co)}
                  aria-label="Delete change order"
                  title="Delete change order"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger/15 hover:text-danger"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setShowForm(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-charcoal">
                Add change order
              </h2>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-white/10"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  CO number
                </label>
                <input
                  className={inputClass}
                  value={coNumber}
                  onChange={(e) => setCoNumber(e.target.value)}
                  placeholder="e.g. 001"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  Description
                </label>
                <input
                  className={inputClass}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What changed?"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  Amount (USD) <span className="text-amber">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  className={inputClass}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Negative for a credit"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  Affected phase
                </label>
                <select
                  className={inputClass}
                  value={phaseId}
                  onChange={(e) => setPhaseId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  CO date
                </label>
                <input
                  type="date"
                  className={inputClass}
                  value={coDate}
                  onChange={(e) => setCoDate(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  Signed CO (optional)
                </label>
                {pendingFile ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-surfaceBorder px-3 py-2 text-sm">
                    <span className="truncate text-charcoal">
                      {pendingFile.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingFile(null)}
                      className="shrink-0 text-muted hover:text-danger"
                      aria-label="Remove file"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-surfaceBorder px-4 text-sm font-medium text-charcoal hover:bg-white/5">
                    Choose file
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPT}
                      className="hidden"
                      onChange={onPickFile}
                    />
                  </label>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={submitting}
                  className="min-h-[44px] flex-1 rounded-lg border border-surfaceBorder px-4 font-medium text-charcoal transition hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] flex-1 rounded-lg bg-amber px-4 font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
                >
                  {submitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
