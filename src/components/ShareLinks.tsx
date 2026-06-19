import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'
import type { ProjectViewLink } from '../lib/types'

interface Props {
  projectId: string
  createdBy: string | null
}

/** 48-char random hex token, generated client-side. */
function genToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function shortToken(token: string): string {
  return token.length > 12 ? `${token.slice(0, 6)}…${token.slice(-4)}` : token
}

export default function ShareLinks({ projectId, createdBy }: Props) {
  const [links, setLinks] = useState<ProjectViewLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const linkUrl = (token: string) => `${window.location.origin}/v/${token}`

  const load = useCallback(async () => {
    const { data, error: loadErr } = await supabase
      .from('project_view_links')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (loadErr) {
      setError(loadErr.message)
      setLoading(false)
      return
    }
    setLinks((data ?? []) as ProjectViewLink[])
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const onCopy = async (link: ProjectViewLink) => {
    try {
      await navigator.clipboard.writeText(linkUrl(link.token))
      setCopiedId(link.id)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopiedId(null), 2000)
    } catch {
      setError('Could not copy the link — copy it manually.')
    }
  }

  const onAdd = async () => {
    setAdding(true)
    setError(null)
    const { error: insErr } = await supabase.from('project_view_links').insert({
      project_id: projectId,
      token: genToken(),
      label: label.trim() || null,
      created_by: createdBy,
    })
    setAdding(false)
    if (insErr) {
      setError(insErr.message)
      return
    }
    setLabel('')
    await load()
  }

  const onRevoke = async (link: ProjectViewLink) => {
    const ok = window.confirm(
      `Turn off the link "${link.label || 'Untitled'}"? Anyone using it will lose access.`,
    )
    if (!ok) return
    setError(null)
    const { error: updErr } = await supabase
      .from('project_view_links')
      .update({ revoked: true })
      .eq('id', link.id)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await load()
  }

  const active = links.filter((l) => !l.revoked)
  const revoked = links.filter((l) => l.revoked)

  return (
    <div>
      <p className="text-xs text-muted">
        Anyone with this link can VIEW this job's progress, photos, and status —
        no login. They cannot see any financials or documents. Revoke a link any
        time to turn it off.
      </p>

      {/* Add a link */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Banker, Homeowner)"
          className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          className="min-h-[44px] rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
        >
          {adding ? 'Adding…' : 'Add share link'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      ) : links.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No share links yet.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {active.map((link) => (
            <div
              key={link.id}
              className="rounded-xl border border-surfaceBorder bg-field p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-charcoal">
                    {link.label || 'Untitled'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    <code>{shortToken(link.token)}</code> · created{' '}
                    {formatDate(link.created_at)}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onCopy(link)}
                  className="min-h-[40px] flex-1 rounded-lg bg-amber px-3 text-sm font-medium text-white transition hover:bg-amber-700"
                >
                  {copiedId === link.id ? 'Copied!' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => onRevoke(link)}
                  className="min-h-[40px] rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-danger transition hover:bg-danger/10"
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}

          {revoked.length > 0 && (
            <div className="pt-2">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Revoked
              </p>
              <div className="space-y-2">
                {revoked.map((link) => (
                  <div
                    key={link.id}
                    className="rounded-xl border border-surfaceBorder/60 bg-field/50 p-3 opacity-60"
                  >
                    <p className="font-medium text-muted line-through">
                      {link.label || 'Untitled'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      <code>{shortToken(link.token)}</code> · created{' '}
                      {formatDate(link.created_at)} · turned off
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
