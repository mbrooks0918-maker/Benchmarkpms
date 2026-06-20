import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

interface OrgPm {
  user_id: string
  full_name: string | null
}

interface Props {
  projectId: string
}

/**
 * Owner-only panel to assign/unassign the org's PMs to this project. Renders
 * nothing for non-owners (PMs never see it). Toggling a checkbox writes the
 * project_assignments row immediately.
 */
export default function AssignedPMs({ projectId }: Props) {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null

  const [isOwner, setIsOwner] = useState(false)
  const [ready, setReady] = useState(false)
  const [pms, setPms] = useState<OrgPm[]>([])
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    // Owner check first — bail (and render nothing) for PMs.
    const { data: me } = await supabase
      .from('org_members')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle()
    const owner = me?.role === 'owner'
    setIsOwner(owner)
    if (!owner) {
      setReady(true)
      return
    }

    const [pmRes, assignRes] = await Promise.all([
      supabase.rpc('org_members_list'),
      supabase
        .from('project_assignments')
        .select('user_id')
        .eq('project_id', projectId),
    ])
    const pmRows = (
      (pmRes.data ?? []) as {
        user_id: string
        full_name: string | null
        role: string
      }[]
    ).filter((r) => r.role === 'pm')
    setPms(pmRows.map((r) => ({ user_id: r.user_id, full_name: r.full_name })))
    setAssigned(
      new Set(
        ((assignRes.data ?? []) as { user_id: string }[]).map((a) => a.user_id),
      ),
    )
    setReady(true)
  }, [userId, projectId])

  useEffect(() => {
    load()
  }, [load])

  const flashSaved = () => {
    setSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 1500)
  }

  const toggle = async (pmId: string) => {
    const currentlyAssigned = assigned.has(pmId)
    setSavingId(pmId)
    setError(null)
    // Optimistic local update.
    setAssigned((prev) => {
      const next = new Set(prev)
      if (currentlyAssigned) next.delete(pmId)
      else next.add(pmId)
      return next
    })

    const { error: opErr } = currentlyAssigned
      ? await supabase
          .from('project_assignments')
          .delete()
          .eq('project_id', projectId)
          .eq('user_id', pmId)
      : await supabase
          .from('project_assignments')
          .insert({ project_id: projectId, user_id: pmId })

    setSavingId(null)
    if (opErr) {
      // Revert on failure.
      setAssigned((prev) => {
        const next = new Set(prev)
        if (currentlyAssigned) next.add(pmId)
        else next.delete(pmId)
        return next
      })
      setError(opErr.message)
      return
    }
    flashSaved()
  }

  // Hide entirely for PMs (and until the owner check resolves).
  if (!ready || !isOwner) return null

  return (
    <section className="rounded-2xl border border-surfaceBorder bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-charcoal">
          Assigned Project Managers
        </h2>
        {saved && (
          <span className="text-xs font-medium text-success">Saved</span>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {pms.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          No project managers yet — invite one on the Team page.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {pms.map((pm) => {
            const checked = assigned.has(pm.user_id)
            return (
              <label
                key={pm.user_id}
                className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-surfaceBorder bg-field px-3"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={savingId === pm.user_id}
                  onChange={() => toggle(pm.user_id)}
                  className="h-5 w-5 shrink-0 cursor-pointer rounded border-surfaceBorder accent-amber disabled:opacity-50"
                />
                <span className="text-sm text-ink">
                  {pm.full_name?.trim() || 'PM'}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </section>
  )
}
