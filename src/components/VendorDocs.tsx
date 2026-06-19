import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { supabase } from '../lib/supabase'
import type { Phase, VendorDoc, VendorDocType } from '../lib/types'
import { ensureDisplayableImage } from '../lib/heic'

const BUCKET = 'vendor-docs'
const SIGNED_URL_TTL = 60 * 60 // 60 minutes

const DOC_TYPES: VendorDocType[] = [
  'Invoice',
  'Quote',
  'COI',
  'W-9',
  'Lien Waiver',
  'Other',
]

// Accepted upload types: pdf, images (jpg/png/heic), Word, Excel.
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

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

interface Props {
  projectId: string
  uploadedBy: string | null
  phases: Phase[]
  /** When inside a collapsible panel, the panel supplies the title. */
  embedded?: boolean
}

function todayISO(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function VendorDocs({
  projectId,
  uploadedBy,
  phases,
  embedded = false,
}: Props) {
  const [docs, setDocs] = useState<VendorDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Upload form state.
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [vendorName, setVendorName] = useState('')
  const [docType, setDocType] = useState<VendorDocType>('Invoice')
  const [amount, setAmount] = useState('')
  const [phaseId, setPhaseId] = useState('')
  const [docDate, setDocDate] = useState(todayISO())
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // In-app viewer (mirrors the Documents viewer / photo lightbox).
  const [viewer, setViewer] = useState<{ doc: VendorDoc; url: string } | null>(
    null,
  )

  useEffect(() => {
    if (!viewer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewer(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer])

  const phaseNameById = new Map(phases.map((p) => [p.id, p.name]))

  const load = useCallback(async () => {
    const { data, error: loadErr } = await supabase
      .from('vendor_docs')
      .select('*')
      .eq('project_id', projectId)
      .order('doc_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (loadErr) {
      setError(loadErr.message)
      setLoading(false)
      return
    }
    setDocs((data ?? []) as VendorDoc[])
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const resetForm = () => {
    setPendingFile(null)
    setVendorName('')
    setDocType('Invoice')
    setAmount('')
    setPhaseId('')
    setDocDate(todayISO())
  }

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (inputRef.current) inputRef.current.value = ''
    if (file) {
      setError(null)
      resetForm()
      setPendingFile(file)
    }
  }

  const onUpload = async () => {
    if (!pendingFile) return
    if (!vendorName.trim()) {
      setError('Vendor name is required.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      // Convert iPhone HEIC/HEIF to JPEG so it previews everywhere.
      const file = await ensureDisplayableImage(pendingFile)
      const path = `${projectId}/${Date.now()}-${file.name}`

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })
      if (upErr) throw upErr

      const { error: insErr } = await supabase.from('vendor_docs').insert({
        project_id: projectId,
        phase_id: phaseId || null,
        vendor_name: vendorName.trim(),
        doc_type: docType,
        // Recorded reference only — never feeds totals/draws.
        amount: amount.trim() ? Number(amount) : null,
        doc_date: docDate || null,
        file_name: file.name,
        storage_path: path,
        file_size: file.size,
        mime_type: file.type || null,
        uploaded_by: uploadedBy,
      })
      if (insErr) {
        // Roll back the orphaned upload so storage and DB stay consistent.
        await supabase.storage.from(BUCKET).remove([path])
        throw insErr
      }

      resetForm()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const onView = async (doc: VendorDoc) => {
    setError(null)
    const { data, error: urlErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_path, SIGNED_URL_TTL)
    if (urlErr || !data?.signedUrl) {
      setError(urlErr?.message ?? 'Could not open document.')
      return
    }
    setViewer({ doc, url: data.signedUrl })
  }

  const onDelete = async (doc: VendorDoc) => {
    if (!window.confirm(`Delete "${doc.file_name}"?`)) return
    setError(null)
    const { error: rmErr } = await supabase.storage
      .from(BUCKET)
      .remove([doc.storage_path])
    if (rmErr) {
      setError(rmErr.message)
      return
    }
    const { error: delErr } = await supabase
      .from('vendor_docs')
      .delete()
      .eq('id', doc.id)
    if (delErr) {
      setError(delErr.message)
      return
    }
    await load()
  }

  const inputClass =
    'min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber'

  const AddControl = (
    <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg bg-amber px-4 font-medium text-white transition hover:bg-amber-700">
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
        <path d="M12 3v12" />
        <path d="m7 8 5-5 5 5" />
        <path d="M5 21h14" />
      </svg>
      Add vendor doc
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={onPickFile}
      />
    </label>
  )

  const UploadForm = pendingFile && (
    <div className="space-y-3 rounded-xl border border-surfaceBorder bg-surface p-4 shadow-sm">
      <p className="truncate text-sm font-medium text-charcoal">
        {pendingFile.name}{' '}
        <span className="font-normal text-muted">
          ({formatSize(pendingFile.size)})
        </span>
      </p>

      <div>
        <label className="mb-1 block text-sm font-medium text-charcoal">
          Vendor name <span className="text-amber">*</span>
        </label>
        <input
          className={inputClass}
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          placeholder="e.g. ABC Concrete"
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-charcoal">
            Doc type
          </label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as VendorDocType)}
            className={inputClass}
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-charcoal">
            Amount (USD)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            className={inputClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-charcoal">
            Phase
          </label>
          <select
            value={phaseId}
            onChange={(e) => setPhaseId(e.target.value)}
            className={inputClass}
          >
            <option value="">Not tied to a phase</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-charcoal">
            Date
          </label>
          <input
            type="date"
            className={inputClass}
            value={docDate}
            onChange={(e) => setDocDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={resetForm}
          disabled={uploading}
          className="min-h-[44px] flex-1 rounded-lg border border-surfaceBorder px-4 font-medium text-charcoal hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onUpload}
          disabled={uploading}
          className="min-h-[44px] flex-1 rounded-lg bg-amber px-4 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </div>
  )

  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-3">
        {!embedded && (
          <h2 className="text-xl font-semibold text-charcoal">Vendor Docs</h2>
        )}
        {docs.length > 0 && !pendingFile && AddControl}
      </div>

      <p className="mb-3 text-xs text-muted">
        Vendor invoices, quotes, COIs, W-9s, and lien waivers — kept separate
        from the job's own documents.
      </p>

      {error && (
        <p className="mb-3 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {pendingFile && <div className="mb-3">{UploadForm}</div>}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surfaceBorder bg-surface/40 p-6 text-center">
          <p className="mb-4 text-sm text-muted">No vendor docs yet.</p>
          {!pendingFile && <div className="flex justify-center">{AddControl}</div>}
        </div>
      ) : (
        <ul className="divide-y divide-surfaceBorder/60 rounded-xl border border-surfaceBorder bg-surface shadow-sm">
          {docs.map((doc) => {
            const phaseName = doc.phase_id
              ? phaseNameById.get(doc.phase_id) ?? null
              : null
            return (
              <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-charcoal">
                      {doc.vendor_name}
                    </span>
                    <span className="rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      {doc.doc_type}
                    </span>
                    {doc.amount != null && (
                      <span className="rounded bg-field px-1.5 py-0.5 text-xs font-medium text-ink">
                        {usd.format(doc.amount)}
                      </span>
                    )}
                    {phaseName && (
                      <span className="rounded bg-track px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        {phaseName}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{formatDate(doc.doc_date)}</span>
                    <span>·</span>
                    <span className="truncate">{doc.file_name}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onView(doc)}
                    aria-label={`View ${doc.file_name}`}
                    title="View"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-amber-700"
                  >
                    {/* eye icon */}
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
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(doc)}
                    aria-label={`Delete ${doc.file_name}`}
                    title="Delete"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-danger/15 hover:text-danger"
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
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* In-app viewer — mirrors the Documents viewer. */}
      {viewer &&
        (() => {
          const doc = viewer.doc
          const isPdf =
            doc.mime_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name)
          const isImage = doc.mime_type?.startsWith('image/') ?? false
          const downloadUrl =
            viewer.url +
            (viewer.url.includes('?') ? '&' : '?') +
            'download=' +
            encodeURIComponent(doc.file_name)

          return (
            <div
              className="fixed inset-0 z-50 flex flex-col bg-black/80 p-3 sm:p-4"
              onClick={() => setViewer(null)}
              role="dialog"
              aria-modal="true"
            >
              <div
                className="mx-auto mb-3 flex w-full max-w-5xl items-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                  {doc.file_name}
                </p>
                <a
                  href={downloadUrl}
                  download={doc.file_name}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700"
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
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M12 15V3" />
                  </svg>
                  Download
                </a>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setViewer(null)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface/90 text-charcoal shadow-lg transition hover:bg-surface"
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
              </div>

              <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center overflow-hidden">
                {isPdf ? (
                  <iframe
                    src={viewer.url}
                    title={doc.file_name}
                    onClick={(e) => e.stopPropagation()}
                    className="h-full w-full rounded-lg bg-white"
                  />
                ) : isImage ? (
                  <img
                    src={viewer.url}
                    alt={doc.file_name}
                    onClick={(e) => e.stopPropagation()}
                    className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
                  />
                ) : (
                  <div
                    className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="truncate font-medium text-charcoal">
                      {doc.file_name}
                    </p>
                    <p className="mt-2 text-sm text-muted">
                      Preview not available for this file type.
                    </p>
                    <a
                      href={downloadUrl}
                      download={doc.file_name}
                      className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-amber px-5 font-medium text-white transition hover:bg-amber-700"
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
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <path d="M7 10l5 5 5-5" />
                        <path d="M12 15V3" />
                      </svg>
                      Download
                    </a>
                  </div>
                )}
              </div>
            </div>
          )
        })()}
    </section>
  )
}
