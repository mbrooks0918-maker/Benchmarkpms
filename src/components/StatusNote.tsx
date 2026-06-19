import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { daysSince } from '../lib/format'

interface Props {
  projectId: string
  note: string | null
  updatedAt: string | null
  onSaved: () => void
}

type Tone = 'normal' | 'warn' | 'stale'

const TONE: Record<
  Tone,
  { container: string; label: string; meta: string }
> = {
  normal: {
    container: 'border-l-4 border-accent bg-accent/10',
    label: 'text-accent',
    meta: 'text-muted',
  },
  warn: {
    container: 'border-l-4 border-warning bg-warning/10',
    label: 'text-warning',
    meta: 'text-warning',
  },
  stale: {
    container: 'border-l-4 border-danger bg-danger/10',
    label: 'text-danger',
    meta: 'text-danger',
  },
}

function agoLabel(days: number | null): string {
  if (days == null) return ''
  if (days <= 0) return 'just now'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export default function StatusNote({
  projectId,
  note,
  updatedAt,
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = (note ?? '').trim()
  const hasNote = trimmed.length > 0
  const days = daysSince(updatedAt)

  // Staleness cue on the note itself.
  let tone: Tone = 'normal'
  if (!hasNote) {
    tone = 'warn' // never set / cleared → needs an update
  } else if (days == null || days > 10) {
    tone = 'stale'
  } else if (days > 5) {
    tone = 'warn'
  }
  const t = TONE[tone]

  const openEditor = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setText(note ?? '')
    setError(null)
    setEditing(true)
  }

  const onSave = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSaving(true)
    setError(null)
    const { error: updErr } = await supabase
      .from('projects')
      .update({
        status_note: text.trim() || null,
        status_note_updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
    setSaving(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    setEditing(false)
    onSaved()
  }

  const onCancel = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditing(false)
    setText(note ?? '')
    setError(null)
  }

  if (editing) {
    return (
      <div
        className="rounded-lg border-l-4 border-accent bg-field px-3 py-2"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">
          Status update
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          autoFocus
          placeholder="What's the headline? (what's next / what we're waiting on)"
          className="mt-1 w-full rounded-lg border border-surfaceBorder bg-surface text-ink placeholder:text-muted px-2.5 py-1.5 text-sm outline-none focus:border-amber focus:ring-1 focus:ring-amber"
        />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="min-h-[40px] flex-1 rounded-lg bg-amber px-3 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="min-h-[40px] flex-1 rounded-lg border border-surfaceBorder bg-surface px-3 text-sm font-medium text-charcoal transition hover:bg-white/5"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-lg px-3 py-2 ${t.container}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={`text-[10px] font-semibold uppercase tracking-wide ${t.label}`}
          >
            Status
          </p>
          {hasNote ? (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm font-medium text-ink">
              {trimmed}
            </p>
          ) : (
            <p className="mt-0.5 text-sm italic text-muted">No status update</p>
          )}
        </div>
        <button
          type="button"
          onClick={openEditor}
          aria-label="Edit status note"
          title="Edit status note"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-white/10 hover:text-amber-700"
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
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </div>
      <p className={`mt-1 text-[11px] font-medium ${t.meta}`}>
        {hasNote && days != null
          ? `Updated ${agoLabel(days)}`
          : 'Needs a status update'}
      </p>
    </div>
  )
}
