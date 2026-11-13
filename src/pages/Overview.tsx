import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Phase, Project } from '../lib/types'

// Freshness palette (drives the ring COLOR — not completion).
const FRESH = {
  green: '#4ABE7C', // ≤ 3 days
  yellow: '#E0A02B', // 4–7 days
  red: '#E2544A', // > 7 days, or no activity
} as const

type Freshness = keyof typeof FRESH

function freshnessFor(days: number | null): Freshness {
  if (days == null) return 'red'
  if (days <= 3) return 'green'
  if (days <= 7) return 'yellow'
  return 'red'
}

function agoLabel(days: number | null): string {
  if (days == null) return 'no activity'
  if (days <= 0) return 'today'
  return `${days}d ago`
}

/** Whole days between now and an ISO date/timestamp (null if unparseable). */
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const anchored = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso
  const t = new Date(anchored).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

/** Larger (more recent) of two ISO strings; null-safe. */
function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

interface OverviewCard {
  id: string
  name: string
  statusNote: string | null
  pct: number
  currentPhase: string | null
  freshDays: number | null
}

// ── Completion ring: fill = completion %, color = freshness ────────────────
function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 42
  const c = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, pct))
  const offset = c * (1 - clamped / 100)
  return (
    <div className="relative h-28 w-28">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#12233C"
          strokeWidth="9"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none text-ink">{clamped}%</span>
        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          complete
        </span>
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  )
}

export default function Overview() {
  const [cards, setCards] = useState<OverviewCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)

    // Projects (RLS scopes: owner → org, PM → assigned).
    const { data: projRows, error: projErr } = await supabase
      .from('projects')
      .select('id, name, status, status_note, status_note_updated_at')
    if (projErr) {
      setError(projErr.message)
      setLoading(false)
      return
    }
    const allProjects = (projRows ?? []) as Pick<
      Project,
      'id' | 'name' | 'status' | 'status_note' | 'status_note_updated_at'
    >[]
    // Overview tracks active work only — completed jobs drop off (they live on
    // the dashboard's Completed list). Mirrors the dashboard's active filter;
    // null/on_hold stay visible, only 'complete' is excluded.
    const projects = allProjects.filter((p) => p.status !== 'complete')
    const projectIds = projects.map((p) => p.id)

    // Phases for all projects, then benchmarks for all those phases — batched,
    // no per-project round trips.
    let phasesByProject = new Map<string, Phase[]>()
    let latestDoneByProject = new Map<string, string | null>()

    if (projectIds.length > 0) {
      const { data: phaseRows } = await supabase
        .from('phases')
        .select('id, project_id, name, sequence_order, status, progress_pct')
        .in('project_id', projectIds)
        .order('sequence_order', { ascending: true })
      const phases = (phaseRows ?? []) as Phase[]

      phasesByProject = new Map()
      const phaseToProject = new Map<string, string>()
      for (const ph of phases) {
        phaseToProject.set(ph.id, ph.project_id)
        const arr = phasesByProject.get(ph.project_id) ?? []
        arr.push(ph)
        phasesByProject.set(ph.project_id, arr)
      }

      const phaseIds = phases.map((p) => p.id)
      if (phaseIds.length > 0) {
        const { data: benchRows } = await supabase
          .from('benchmarks')
          .select('phase_id, completed, completed_date')
          .in('phase_id', phaseIds)
        for (const b of (benchRows ?? []) as {
          phase_id: string
          completed: boolean
          completed_date: string | null
        }[]) {
          if (!b.completed || !b.completed_date) continue
          const projId = phaseToProject.get(b.phase_id)
          if (!projId) continue
          latestDoneByProject.set(
            projId,
            maxIso(latestDoneByProject.get(projId) ?? null, b.completed_date),
          )
        }
      }
    }

    const built: OverviewCard[] = projects.map((p) => {
      const phases = phasesByProject.get(p.id) ?? []
      const pct =
        phases.length > 0
          ? Math.round(
              phases.reduce((s, ph) => s + (ph.progress_pct ?? 0), 0) /
                phases.length,
            )
          : 0

      // Current phase: first in_progress, else first non-complete.
      const current =
        phases.find((ph) => ph.status === 'in_progress') ??
        phases.find((ph) => ph.status !== 'complete') ??
        null

      // Freshness = most recent of latest completed benchmark + status note.
      const lastActivity = maxIso(
        latestDoneByProject.get(p.id) ?? null,
        p.status_note_updated_at,
      )

      return {
        id: p.id,
        name: p.name,
        statusNote: p.status_note,
        pct,
        currentPhase: current?.name ?? null,
        freshDays: daysSince(lastActivity),
      }
    })

    setCards(built)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Stalest first (red → top), then by name. No-activity sorts as most stale.
  const sorted = useMemo(() => {
    const key = (c: OverviewCard) =>
      c.freshDays == null ? Number.POSITIVE_INFINITY : c.freshDays
    return [...cards].sort(
      (a, b) => key(b) - key(a) || a.name.localeCompare(b.name),
    )
  }, [cards])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-amber border-t-transparent" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold text-charcoal">Overview</h1>
        <div className="flex flex-wrap items-center gap-3">
          <LegendDot color={FRESH.green} label="≤ 3 days" />
          <LegendDot color={FRESH.yellow} label="4–7 days" />
          <LegendDot color={FRESH.red} label="> 7 days" />
        </div>
      </div>
      <p className="mb-6 text-sm text-muted">
        Ring fill shows completion; ring color shows how recently the job saw
        activity. Stale jobs rise to the top.
      </p>

      {error && (
        <p className="mb-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-surfaceBorder bg-surface/40 p-10 text-center">
          <p className="text-sm text-muted">No projects to show yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((c) => {
            const fresh = freshnessFor(c.freshDays)
            const color = FRESH[fresh]
            return (
              <Link
                key={c.id}
                to={`/project/${c.id}`}
                className="group flex flex-col items-center rounded-2xl border border-surfaceBorder bg-surface p-5 text-center shadow-sm transition hover:border-amber/40 hover:shadow-md"
              >
                <Ring pct={c.pct} color={color} />

                <h2 className="mt-4 font-semibold text-charcoal">{c.name}</h2>

                <p className="mt-1 text-sm text-muted">
                  {c.currentPhase ?? 'All phases complete'}
                </p>

                {c.statusNote && (
                  <p className="mt-2 line-clamp-2 text-xs italic text-muted">
                    “{c.statusNote}”
                  </p>
                )}

                <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <span style={{ color }}>{agoLabel(c.freshDays)}</span>
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
