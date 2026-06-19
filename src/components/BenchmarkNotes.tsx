import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ProgressUpdate } from '../lib/types'
import { formatDate } from '../lib/format'

interface Props {
  projectId: string
  phaseId: string
  benchmarkId: string
  authorId: string | null
}

interface NoteWithAuthor extends ProgressUpdate {
  authorName: string | null
}

export default function BenchmarkNotes({
  projectId,
  phaseId,
  benchmarkId,
  authorId,
}: Props) {
  const [notes, setNotes] = useState<NoteWithAuthor[]>([])
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: loadErr } = await supabase
      .from('progress_updates')
      .select('*')
      .eq('benchmark_id', benchmarkId)
      .order('created_at', { ascending: false })

    if (loadErr) {
      setError(loadErr.message)
      return
    }

    const rows = (data ?? []) as ProgressUpdate[]
    if (rows.length === 0) {
      setNotes([])
      return
    }

    // Look up author names in one query; fall back to nothing if unavailable.
    const authorIds = [...new Set(rows.map((r) => r.author_id).filter(Boolean))] as string[]
    const nameById = new Map<string, string | null>()
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', authorIds)
      for (const p of profiles ?? []) {
        nameById.set(p.id as string, (p.full_name as string | null) ?? null)
      }
    }

    setNotes(
      rows.map((r) => ({
        ...r,
        authorName: r.author_id ? nameById.get(r.author_id) ?? null : null,
      })),
    )
  }, [benchmarkId])

  useEffect(() => {
    load()
  }, [load])

  const onSave = async () => {
    const note = text.trim()
    if (!note) return
    setSaving(true)
    setError(null)
    try {
      const { error: insErr } = await supabase.from('progress_updates').insert({
        project_id: projectId,
        phase_id: phaseId,
        benchmark_id: benchmarkId,
        author_id: authorId,
        note,
      })
      if (insErr) throw insErr
      setText('')
      setAdding(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note.')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (note: NoteWithAuthor) => {
    if (!window.confirm('Delete this note?')) return
    setError(null)
    const { error: delErr } = await supabase
      .from('progress_updates')
      .delete()
      .eq('id', note.id)
    if (delErr) {
      setError(delErr.message)
      return
    }
    await load()
  }

  return (
    <div className="mt-2">
      {/* Existing notes — visually secondary so they don't clutter the row. */}
      {notes.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {notes.map((n) => (
            <li
              key={n.id}
              className="flex items-start gap-2 rounded-lg bg-field/60 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-sm text-charcoal">
                  {n.note}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {n.authorName ? `${n.authorName} · ` : ''}
                  {formatDate(n.created_at)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Delete note"
                onClick={() => onDelete(n)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-danger/15 hover:text-danger"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Add a note…"
            className="w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 py-2 text-sm outline-none focus:border-amber focus:ring-1 focus:ring-amber"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !text.trim()}
              className="min-h-[40px] rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save note'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setText('')
                setError(null)
              }}
              disabled={saving}
              className="min-h-[40px] rounded-lg border border-surfaceBorder px-4 text-sm font-medium text-charcoal transition hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted transition hover:bg-white/5 hover:text-amber-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          + Note
        </button>
      )}

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
