import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { supabase } from '../lib/supabase'
import type { DocumentCategory, ProjectDocument } from '../lib/types'
import { ensureDisplayableImage } from '../lib/heic'

const BUCKET = 'project-docs'
const SIGNED_URL_TTL = 60 * 60 // 60 minutes

const CATEGORIES: DocumentCategory[] = [
  'Contract',
  'Bank Estimate',
  'Permit',
  'Invoice',
  'Photo',
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

interface Props {
  projectId: string
  uploadedBy: string | null
  /** Bump this to force a reload (e.g. after a change order adds a document). */
  reloadKey?: number
  /** When inside a collapsible panel, the panel supplies the title. */
  embedded?: boolean
}

interface DocWithThumb extends ProjectDocument {
  thumbUrl?: string | null
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

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ProjectDocuments({
  projectId,
  uploadedBy,
  reloadKey = 0,
  embedded = false,
}: Props) {
  const [docs, setDocs] = useState<DocWithThumb[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [category, setCategory] = useState<DocumentCategory>('Other')
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // In-app document viewer (mirrors the benchmark photo lightbox).
  const [viewer, setViewer] = useState<{
    doc: ProjectDocument
    url: string
  } | null>(null)

  // Close the viewer on Esc.
  useEffect(() => {
    if (!viewer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewer(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer])

  const load = useCallback(async () => {
    const { data, error: loadErr } = await supabase
      .from('documents')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (loadErr) {
      setError(loadErr.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as ProjectDocument[]

    // Signed URLs for image thumbnails.
    const imageRows = rows.filter((r) => r.mime_type?.startsWith('image/'))
    const thumbByPath = new Map<string, string>()
    if (imageRows.length > 0) {
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(
          imageRows.map((r) => r.storage_path),
          SIGNED_URL_TTL,
        )
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) thumbByPath.set(s.path, s.signedUrl)
      }
    }

    setDocs(
      rows.map((r) => ({
        ...r,
        thumbUrl: r.mime_type?.startsWith('image/')
          ? thumbByPath.get(r.storage_path) ?? null
          : null,
      })),
    )
    setLoading(false)
    // reloadKey is intentionally a dependency: bumping it re-runs this loader.
  }, [projectId, reloadKey])

  useEffect(() => {
    load()
  }, [load])

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (inputRef.current) inputRef.current.value = ''
    if (file) {
      setError(null)
      setPendingFile(file)
      setCategory('Other')
    }
  }

  const onUpload = async () => {
    if (!pendingFile) return
    setUploading(true)
    setError(null)
    try {
      // Convert iPhone HEIC/HEIF to JPEG so the image thumbnail always renders.
      const file = await ensureDisplayableImage(pendingFile)
      const path = `${projectId}/${Date.now()}-${file.name}`

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })
      if (upErr) throw upErr

      const { error: insErr } = await supabase.from('documents').insert({
        project_id: projectId,
        category,
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

      setPendingFile(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const onView = async (doc: ProjectDocument) => {
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

  const onDelete = async (doc: ProjectDocument) => {
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
      .from('documents')
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

  const UploadControl = (
    <div>
      {!pendingFile ? (
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
          Upload document
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={onPickFile}
          />
        </label>
      ) : (
        <div className="space-y-3 rounded-xl border border-surfaceBorder bg-surface p-4 shadow-sm">
          <p className="truncate text-sm font-medium text-charcoal">
            {pendingFile.name}{' '}
            <span className="font-normal text-muted">
              ({formatSize(pendingFile.size)})
            </span>
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium text-charcoal">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as DocumentCategory)}
              className={inputClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPendingFile(null)}
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
      )}
    </div>
  )

  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-3">
        {!embedded && (
          <h2 className="text-xl font-semibold text-charcoal">Documents</h2>
        )}
        {docs.length > 0 && !pendingFile && UploadControl}
      </div>

      <p className="mb-3 text-xs text-muted">
        PDFs and image files (JPG, PNG) preview best. Word and Excel files can
        still be uploaded and downloaded, but won't preview in-app.
      </p>

      {error && (
        <p className="mb-3 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {pendingFile && <div className="mb-3">{UploadControl}</div>}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surfaceBorder bg-surface/40 p-6 text-center">
          <p className="mb-4 text-sm text-muted">No documents yet.</p>
          {!pendingFile && <div className="flex justify-center">{UploadControl}</div>}
        </div>
      ) : (
        <div className="space-y-5">
          {CATEGORIES.filter((c) => docs.some((d) => d.category === c)).map(
            (cat) => (
              <div key={cat}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                  {cat}
                </h3>
                <ul className="divide-y divide-surfaceBorder/60 rounded-xl border border-surfaceBorder bg-surface shadow-sm">
                  {docs
                    .filter((d) => d.category === cat)
                    .map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        {doc.thumbUrl ? (
                          <img
                            src={doc.thumbUrl}
                            alt=""
                            className="h-12 w-12 shrink-0 rounded-lg border border-surfaceBorder object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-surfaceBorder bg-field text-muted">
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
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <path d="M14 2v6h6" />
                            </svg>
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-charcoal">
                            {doc.file_name}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                            <span className="rounded bg-amber/10 px-1.5 py-0.5 font-medium text-amber-700">
                              {doc.category}
                            </span>
                            <span>{formatSize(doc.file_size)}</span>
                            <span>·</span>
                            <span>{formatDate(doc.created_at)}</span>
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
                    ))}
                </ul>
              </div>
            ),
          )}
        </div>
      )}

      {/* In-app document viewer — mirrors the benchmark photo lightbox. */}
      {viewer &&
        (() => {
          const doc = viewer.doc
          const isPdf =
            doc.mime_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name)
          const isImage = doc.mime_type?.startsWith('image/') ?? false
          // Append a download hint so the signed URL saves with the original
          // file name (works for PDFs and images too).
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
              {/* Toolbar: file name + Download + Close (all types) */}
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

              {/* Body — clicks on the empty area fall through to close. */}
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
