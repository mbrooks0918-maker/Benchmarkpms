import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BenchmarkPhotos from '../components/BenchmarkPhotos'
import BenchmarkNotes from '../components/BenchmarkNotes'
import ChangeOrders from '../components/ChangeOrders'
import DrawItem from '../components/DrawItem'
import EditProjectModal from '../components/EditProjectModal'
import ProjectDocuments from '../components/ProjectDocuments'
import VendorDocs from '../components/VendorDocs'
import StatusNote from '../components/StatusNote'
import SelectionsTab from '../components/SelectionsTab'
import ShareLinks from '../components/ShareLinks'
import AssignedPMs from '../components/AssignedPMs'
import { useOrgRole } from '../lib/useOrgRole'
import { addDays, todayISO } from '../lib/dates'
import { formatDate } from '../lib/format'
import type {
  Benchmark,
  Draw,
  Phase,
  Project,
  ProjectDrawCheck,
} from '../lib/types'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

// Display label for a project type slug; humanizes unknown/custom slugs.
function typeLabel(slug: string): string {
  const known: Record<string, string> = {
    new_build: 'New Build',
    renovation: 'Renovation',
  }
  return (
    known[slug] ??
    slug
      .split(/[_-]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  )
}

// "+$5,000" for an add, "-$5,000" for a credit, "$0" for no change.
function formatSigned(amount: number): string {
  if (amount === 0) return usd.format(0)
  const sign = amount < 0 ? '-' : '+'
  return `${sign}${usd.format(Math.abs(amount))}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Down-chevron that rotates 180° when its section is open.
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 ${
        open ? 'rotate-180' : ''
      }`}
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/**
 * A self-contained collapsible panel: a full-width tappable header (≥44px) with
 * a title, an optional summary, and a rotating chevron. Children stay mounted
 * even when collapsed (so live counts / realtime subscriptions keep working);
 * the body animates open/closed via a grid-rows transition.
 */
function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="overflow-hidden rounded-2xl border border-surfaceBorder bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        {/* Title gets priority; summary wraps to its own line if it can't fit. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-lg font-semibold text-charcoal">{title}</span>
          {summary != null && (
            <span className="text-sm font-medium text-muted">{summary}</span>
          )}
        </span>
        <Chevron open={open} />
      </button>
      <div
        className={`grid transition-all duration-200 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-5">{children}</div>
        </div>
      </div>
    </section>
  )
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  // PMs see schedule/docs/change-orders but not draws or contract-total money.
  const { isOwner } = useOrgRole()

  const [project, setProject] = useState<Project | null>(null)
  const [phases, setPhases] = useState<Phase[]>([])
  const [benchmarksByPhase, setBenchmarksByPhase] = useState<
    Record<string, Benchmark[]>
  >({})
  const [draws, setDraws] = useState<Draw[]>([])
  const [drawCheck, setDrawCheck] = useState<ProjectDrawCheck | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Auto-expand the current phase only on the first load, not on every refresh.
  const didInitExpand = useRef(false)
  const [selProgress, setSelProgress] = useState<{
    answered: number
    total: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [docsReloadKey, setDocsReloadKey] = useState(0)

  const loadAll = useCallback(async () => {
    if (!id) return
    setError(null)

    const [projectRes, phasesRes, drawsRes, checkRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase
        .from('phases')
        .select('*')
        .eq('project_id', id)
        .order('sequence_order', { ascending: true }),
      supabase
        .from('draws')
        .select('*')
        .eq('project_id', id)
        .order('sequence_order', { ascending: true }),
      supabase
        .from('project_draw_check')
        .select('*')
        .eq('project_id', id)
        .maybeSingle(),
    ])

    if (projectRes.error) {
      setError(projectRes.error.message)
      setLoading(false)
      return
    }
    setProject(projectRes.data as Project)
    const loadedPhases = (phasesRes.data ?? []) as Phase[]
    setPhases(loadedPhases)

    // All phases start collapsed on first open. The guard ensures a later
    // background refresh (e.g. after toggling a benchmark) doesn't snap a
    // user's manually-expanded phases closed again.
    if (!didInitExpand.current) {
      didInitExpand.current = true
      setExpanded(new Set())
    }
    setDraws((drawsRes.data ?? []) as Draw[])
    setDrawCheck((checkRes.data as ProjectDrawCheck | null) ?? null)

    // Load all benchmarks for these phases in one query, then group.
    const phaseIds = loadedPhases.map((p) => p.id)
    if (phaseIds.length > 0) {
      const { data: benches } = await supabase
        .from('benchmarks')
        .select('*')
        .in('phase_id', phaseIds)
        .order('sequence_order', { ascending: true })
      const grouped: Record<string, Benchmark[]> = {}
      for (const b of (benches ?? []) as Benchmark[]) {
        ;(grouped[b.phase_id] ||= []).push(b)
      }
      setBenchmarksByPhase(grouped)
    } else {
      setBenchmarksByPhase({})
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Re-read draws + reconciliation after any draw edit/add/remove/invoice.
  const reloadDraws = useCallback(async () => {
    if (!id) return
    const [drawsRes, checkRes] = await Promise.all([
      supabase
        .from('draws')
        .select('*')
        .eq('project_id', id)
        .order('sequence_order', { ascending: true }),
      supabase
        .from('project_draw_check')
        .select('*')
        .eq('project_id', id)
        .maybeSingle(),
    ])
    if (!drawsRes.error) setDraws((drawsRes.data ?? []) as Draw[])
    setDrawCheck((checkRes.data as ProjectDrawCheck | null) ?? null)
  }, [id])

  // After a change order is added/deleted: re-read project (contract), phases,
  // draws and reconciliation, and nudge the Documents list to reload too.
  const onChangeOrdersChanged = useCallback(async () => {
    await loadAll()
    setDocsReloadKey((k) => k + 1)
  }, [loadAll])

  // Re-fetch a single phase + its benchmarks (after a benchmark toggle, so the
  // DB trigger's recalculated progress_pct / status is reflected).
  const refreshPhase = useCallback(async (phaseId: string) => {
    const [phaseRes, benchRes] = await Promise.all([
      supabase.from('phases').select('*').eq('id', phaseId).single(),
      supabase
        .from('benchmarks')
        .select('*')
        .eq('phase_id', phaseId)
        .order('sequence_order', { ascending: true }),
    ])
    if (phaseRes.data) {
      const updated = phaseRes.data as Phase
      setPhases((prev) => prev.map((p) => (p.id === phaseId ? updated : p)))
    }
    setBenchmarksByPhase((prev) => ({
      ...prev,
      [phaseId]: (benchRes.data ?? []) as Benchmark[],
    }))
  }, [])

  const toggleExpand = (phaseId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(phaseId)) next.delete(phaseId)
      else next.add(phaseId)
      return next
    })
  }

  const onToggleBenchmark = async (b: Benchmark, completed: boolean) => {
    const { error: updErr } = await supabase
      .from('benchmarks')
      .update({
        completed,
        completed_date: completed ? todayISO() : null,
        completed_by: completed ? session?.user?.id ?? null : null,
        // Complete and N/A are mutually exclusive.
        not_applicable: completed ? false : b.not_applicable,
      })
      .eq('id', b.id)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await refreshPhase(b.phase_id)
  }

  const onToggleNotApplicable = async (b: Benchmark, na: boolean) => {
    const { error: updErr } = await supabase
      .from('benchmarks')
      .update({
        not_applicable: na,
        // Turning N/A on clears any completion (nothing was actually done).
        completed: na ? false : b.completed,
        completed_date: na ? null : b.completed_date,
        completed_by: na ? null : b.completed_by,
      })
      .eq('id', b.id)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await refreshPhase(b.phase_id)
  }

  const onChangeCompletedDate = async (b: Benchmark, date: string) => {
    const { error: updErr } = await supabase
      .from('benchmarks')
      .update({ completed_date: date || null })
      .eq('id', b.id)
    if (updErr) {
      setError(updErr.message)
      return
    }
    setBenchmarksByPhase((prev) => ({
      ...prev,
      [b.phase_id]: (prev[b.phase_id] ?? []).map((x) =>
        x.id === b.id ? { ...x, completed_date: date || null } : x,
      ),
    }))
  }

  // ── Owner editing: phases & benchmarks ────────────────────────────────────

  /**
   * Swap sequence_order between two rows via a temporary value, so a unique
   * (parent, sequence_order) ordering key is never transiently violated.
   */
  const swapSequence = async (
    table: 'phases' | 'benchmarks',
    a: { id: string; sequence_order: number },
    b: { id: string; sequence_order: number },
    tempSeq: number,
  ): Promise<string | null> => {
    const r1 = await supabase
      .from(table)
      .update({ sequence_order: tempSeq })
      .eq('id', a.id)
    if (r1.error) return r1.error.message
    const r2 = await supabase
      .from(table)
      .update({ sequence_order: a.sequence_order })
      .eq('id', b.id)
    if (r2.error) return r2.error.message
    const r3 = await supabase
      .from(table)
      .update({ sequence_order: b.sequence_order })
      .eq('id', a.id)
    return r3.error ? r3.error.message : null
  }

  const onAddPhase = async () => {
    if (!project) return
    const name = window.prompt('Phase name')?.trim()
    if (!name) return
    setError(null)
    const maxSeq = phases.reduce(
      (m, p) => Math.max(m, p.sequence_order ?? 0),
      0,
    )
    // New phase gets a 7-day window after the last phase (or the project start).
    const last = phases.length ? phases[phases.length - 1] : null
    const start = last?.target_end || project.start_date || todayISO()
    const end = addDays(start, 7)
    const { error: insErr } = await supabase.from('phases').insert({
      project_id: project.id,
      name,
      sequence_order: maxSeq + 1,
      nahb_code: null,
      target_start: start,
      target_end: end,
      baseline_start: start,
      baseline_end: end,
    })
    if (insErr) {
      setError(insErr.message)
      return
    }
    await loadAll()
  }

  const onRenamePhase = async (phase: Phase) => {
    const name = window.prompt('Rename phase', phase.name)?.trim()
    if (!name || name === phase.name) return
    setError(null)
    const { error: updErr } = await supabase
      .from('phases')
      .update({ name })
      .eq('id', phase.id)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await loadAll()
  }

  const onDeletePhase = async (phase: Phase) => {
    if (!window.confirm('Delete this phase and all its items?')) return
    setError(null)
    // Remove this phase's benchmarks first, then the phase.
    const { error: bErr } = await supabase
      .from('benchmarks')
      .delete()
      .eq('phase_id', phase.id)
    if (bErr) {
      setError(bErr.message)
      return
    }
    const { error: pErr } = await supabase
      .from('phases')
      .delete()
      .eq('id', phase.id)
    if (pErr) {
      setError(pErr.message)
      return
    }
    await loadAll()
  }

  const onMovePhase = async (phase: Phase, dir: 'up' | 'down') => {
    const idx = phases.findIndex((p) => p.id === phase.id)
    const j = dir === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || j < 0 || j >= phases.length) return
    setError(null)
    const tempSeq =
      phases.reduce((m, p) => Math.max(m, p.sequence_order ?? 0), 0) + 1
    const err = await swapSequence('phases', phase, phases[j], tempSeq)
    if (err) {
      setError(err)
      return
    }
    await loadAll()
  }

  const onAddBenchmark = async (phaseId: string) => {
    const name = window.prompt('Item name')?.trim()
    if (!name) return
    setError(null)
    const arr = benchmarksByPhase[phaseId] ?? []
    const maxSeq = arr.reduce((m, x) => Math.max(m, x.sequence_order ?? 0), 0)
    const { error: insErr } = await supabase.from('benchmarks').insert({
      phase_id: phaseId,
      name,
      sequence_order: maxSeq + 1,
      is_inspection: false,
      is_procurement: false,
      completed: false,
      not_applicable: false,
    })
    if (insErr) {
      setError(insErr.message)
      return
    }
    await refreshPhase(phaseId)
  }

  const onRenameBenchmark = async (b: Benchmark) => {
    const name = window.prompt('Rename item', b.name)?.trim()
    if (!name || name === b.name) return
    setError(null)
    const { error: updErr } = await supabase
      .from('benchmarks')
      .update({ name })
      .eq('id', b.id)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await refreshPhase(b.phase_id)
  }

  const onDeleteBenchmark = async (b: Benchmark) => {
    if (!window.confirm('Delete this item?')) return
    setError(null)
    const { error: delErr } = await supabase
      .from('benchmarks')
      .delete()
      .eq('id', b.id)
    if (delErr) {
      setError(delErr.message)
      return
    }
    await refreshPhase(b.phase_id)
  }

  const onToggleInspection = async (b: Benchmark) => {
    setError(null)
    const { error: updErr } = await supabase
      .from('benchmarks')
      .update({ is_inspection: !b.is_inspection })
      .eq('id', b.id)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await refreshPhase(b.phase_id)
  }

  const onToggleProcurement = async (b: Benchmark) => {
    setError(null)
    const { error: updErr } = await supabase
      .from('benchmarks')
      .update({ is_procurement: !b.is_procurement })
      .eq('id', b.id)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await refreshPhase(b.phase_id)
  }

  const onMoveBenchmark = async (b: Benchmark, dir: 'up' | 'down') => {
    const arr = benchmarksByPhase[b.phase_id] ?? []
    const idx = arr.findIndex((x) => x.id === b.id)
    const j = dir === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || j < 0 || j >= arr.length) return
    setError(null)
    const tempSeq =
      arr.reduce((m, x) => Math.max(m, x.sequence_order ?? 0), 0) + 1
    const err = await swapSequence('benchmarks', b, arr[j], tempSeq)
    if (err) {
      setError(err)
      return
    }
    await refreshPhase(b.phase_id)
  }

  const onAddDraw = async (phase: Phase) => {
    if (!id) return
    setError(null)
    const nextSeq =
      draws.reduce((max, d) => Math.max(max, d.sequence_order ?? 0), 0) + 1
    const { error: insErr } = await supabase.from('draws').insert({
      project_id: id,
      phase_id: phase.id,
      benchmark_id: null,
      label: `Draw — ${phase.name}`,
      amount_type: 'fixed',
      amount_value: 0,
      sequence_order: nextSeq,
    })
    if (insErr) {
      setError(insErr.message)
      return
    }
    await reloadDraws()
  }

  const onMarkComplete = async () => {
    if (!project) return
    const ok = window.confirm(
      `Mark "${project.name}" complete? It will move to the Completed list on the dashboard.`,
    )
    if (!ok) return
    setStatusBusy(true)
    setError(null)
    const { error: updErr } = await supabase
      .from('projects')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', project.id)
    setStatusBusy(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await loadAll()
  }

  const onReopen = async () => {
    if (!project) return
    setStatusBusy(true)
    setError(null)
    const { error: updErr } = await supabase
      .from('projects')
      .update({ status: 'active', completed_at: null })
      .eq('id', project.id)
    setStatusBusy(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await loadAll()
  }

  // Draws anchored to a phase (no benchmark), grouped by phase id.
  const drawsByPhase = useMemo(() => {
    const m = new Map<string, Draw[]>()
    for (const d of draws) {
      if (d.benchmark_id || !d.phase_id) continue
      const arr = m.get(d.phase_id) ?? []
      arr.push(d)
      m.set(d.phase_id, arr)
    }
    return m
  }, [draws])

  // Draws anchored to a benchmark, grouped by benchmark id.
  const drawsByBenchmark = useMemo(() => {
    const m = new Map<string, Draw[]>()
    for (const d of draws) {
      if (!d.benchmark_id) continue
      const arr = m.get(d.benchmark_id) ?? []
      arr.push(d)
      m.set(d.benchmark_id, arr)
    }
    return m
  }, [draws])

  const total = project?.total_amount ?? null

  // Timeline summary across phases.
  const timeline = useMemo(() => {
    const starts = phases
      .map((p) => p.baseline_start)
      .filter((d): d is string => !!d)
      .sort()
    const ends = phases
      .map((p) => p.baseline_end)
      .filter((d): d is string => !!d)
      .sort()
    const avgPct =
      phases.length > 0
        ? Math.round(
            phases.reduce((sum, p) => sum + (p.progress_pct ?? 0), 0) /
              phases.length,
          )
        : 0
    return {
      start: starts[0] ?? null,
      end: ends[ends.length - 1] ?? null,
      overall: avgPct,
    }
  }, [phases])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-amber border-t-transparent" />
      </div>
    )
  }

  if (error && !project) {
    return (
      <div>
        <Link to="/" className="text-sm text-amber-700">
          ← Back
        </Link>
        <p className="mt-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          Failed to load project: {error}
        </p>
      </div>
    )
  }

  if (!project) return null

  const isComplete = project.status === 'complete'

  // Contract breakdown. If no baseline was ever captured, treat the current
  // total as the original (so change orders read as zero).
  const originalAmount = project.original_amount ?? project.total_amount
  const changeOrdersSum =
    (project.total_amount ?? 0) - (originalAmount ?? 0)

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm font-medium text-amber-700">
          ← All projects
        </Link>
      </div>

      {error && (
        <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Summary panel — at-a-glance header for the job */}
      <header className="rounded-2xl bg-surface p-5 shadow-sm">
        {/* Title + badges */}
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold leading-tight text-charcoal">
            {project.name}
          </h1>
          <span className="shrink-0 rounded-full border border-surfaceBorder px-2.5 py-1 text-xs font-medium text-muted">
            {typeLabel(project.type)}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {isComplete ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
              Completed {formatDate(project.completed_at)}
            </span>
          ) : (
            project.status && (
              <span className="rounded-full bg-amber/10 px-2.5 py-1 text-xs font-medium capitalize text-amber-700">
                {project.status.replace(/_/g, ' ')}
              </span>
            )
          )}
        </div>

        {/* Client + address */}
        {project.client_name && (
          <p className="mt-3 text-ink">{project.client_name}</p>
        )}
        {project.address && (
          <p className="text-sm text-muted">{project.address}</p>
        )}

        {/* Status note — the current headline for the job */}
        <div className="mt-4">
          <StatusNote
            projectId={project.id}
            note={project.status_note}
            updatedAt={project.status_note_updated_at}
            onSaved={loadAll}
          />
        </div>

        {/* Edit + complete/reopen actions */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            className="min-h-[44px] flex-1 rounded-lg border border-surfaceBorder px-4 text-sm font-medium text-charcoal transition hover:bg-white/5"
          >
            Edit
          </button>
          {isComplete ? (
            <button
              type="button"
              onClick={onReopen}
              disabled={statusBusy}
              className="min-h-[44px] flex-1 rounded-lg border border-amber px-4 text-sm font-medium text-amber-700 transition hover:bg-amber/5 disabled:opacity-60"
            >
              {statusBusy ? 'Working…' : 'Reopen'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onMarkComplete}
              disabled={statusBusy}
              className="min-h-[44px] flex-1 rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              {statusBusy ? 'Working…' : 'Mark complete'}
            </button>
          )}
        </div>
      </header>

      {/* Contract & schedule — money parts owner-only; PMs see schedule only */}
      <CollapsibleSection
        title={isOwner ? 'Contract & schedule' : 'Schedule'}
        summary={
          isOwner && project.total_amount != null
            ? usd.format(project.total_amount)
            : undefined
        }
      >
        {/* Contract breakdown: original + change orders = current (owner only) */}
        {isOwner && (
          <div className="space-y-1.5 rounded-xl bg-field p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Original contract</span>
              <span className="font-medium text-charcoal">
                {originalAmount != null ? usd.format(originalAmount) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Change orders</span>
              <span
                className={`font-medium ${
                  changeOrdersSum < 0 ? 'text-danger' : 'text-charcoal'
                }`}
              >
                {formatSigned(changeOrdersSum)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-surfaceBorder pt-1.5">
              <span className="font-semibold text-charcoal">
                Current contract
              </span>
              <span className="text-lg font-bold text-charcoal">
                {project.total_amount != null
                  ? usd.format(project.total_amount)
                  : '—'}
              </span>
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Start
            </p>
            <p className="mt-0.5 font-medium text-charcoal">
              {formatDate(project.start_date)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Target completion
            </p>
            <p className="mt-0.5 font-medium text-charcoal">
              {formatDate(project.target_completion_date)}
            </p>
          </div>
        </div>

        {/* Compact draw reconciliation (fail-safe) — owner only */}
        {isOwner && drawCheck && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              drawCheck.matches
                ? 'bg-success/15 text-success'
                : 'bg-danger/15 text-danger'
            }`}
          >
            <span>
              Draw schedule: {usd.format(drawCheck.draw_sum ?? 0)} of{' '}
              {usd.format(drawCheck.total_amount ?? 0)}
            </span>
            {drawCheck.matches ? (
              <span aria-hidden>✓</span>
            ) : (
              <span>
                — off by {usd.format(Math.abs(drawCheck.difference ?? 0))}
              </span>
            )}
          </div>
        )}

        {/* Timeline summary */}
        <div className="mt-4 border-t border-surfaceBorder/60 pt-3 text-sm text-muted">
          <p>
            Planned{' '}
            <span className="font-medium text-charcoal">
              {fmtDate(timeline.start)}
            </span>{' '}
            →{' '}
            <span className="font-medium text-charcoal">
              {fmtDate(timeline.end)}
            </span>
          </p>
          <p className="mt-1">
            Overall progress:{' '}
            <span className="font-medium text-charcoal">
              {timeline.overall}%
            </span>
          </p>
        </div>
      </CollapsibleSection>

      {/* Phases — collapsed by default like every other section */}
      <CollapsibleSection
        title="Phases"
        summary={
          phases.length === 0
            ? undefined
            : `${timeline.overall}% · ${
                phases.find((p) => p.status !== 'complete')?.name ?? 'Complete'
              }`
        }
      >
        {isOwner && (
          <div className="mb-3">
            <button
              type="button"
              onClick={onAddPhase}
              className="min-h-[40px] rounded-lg border border-dashed border-surfaceBorder px-3 text-sm font-medium text-amber-700 transition hover:bg-amber/5"
            >
              + Add phase
            </button>
          </div>
        )}
        {phases.length === 0 ? (
          <div className="rounded-xl border border-dashed border-surfaceBorder bg-surface/40 p-6 text-center text-sm text-muted">
            No phases for this project.
          </div>
        ) : (
          <div className="space-y-3">
            {phases.map((phase, phaseIdx) => {
              const isOpen = expanded.has(phase.id)
              const benches = benchmarksByPhase[phase.id] ?? []
              const phaseDraws = drawsByPhase.get(phase.id) ?? []
              const phaseComplete = phase.status === 'complete'
              return (
                <div
                  key={phase.id}
                  className="overflow-hidden rounded-xl border border-surfaceBorder bg-surface shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(phase.id)}
                    className="flex w-full min-h-[44px] items-center gap-3 p-4 text-left"
                  >
                    <Chevron open={isOpen} />
                    <div className="min-w-0 flex-1">
                      {/* Phase name wraps in full; status badge sits top-right. */}
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="min-w-0 flex-1 font-semibold text-charcoal">
                          {phase.name}
                        </h3>
                        {phase.status && (
                          <span className="mt-0.5 shrink-0 text-xs capitalize text-muted">
                            {phase.status.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-track">
                          <div
                            className="h-full rounded-full bg-amber transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(0, phase.progress_pct ?? 0))}%`,
                            }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs font-medium text-muted">
                          {Math.round(phase.progress_pct ?? 0)}%
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {fmtDate(phase.target_start)} → {fmtDate(phase.target_end)}
                      </p>
                    </div>
                  </button>

                  {/* Owner phase controls — kept outside the expand button. */}
                  {isOwner && (
                    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                      <button
                        type="button"
                        onClick={() => onMovePhase(phase, 'up')}
                        disabled={phaseIdx === 0}
                        aria-label="Move phase up"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-surfaceBorder text-muted transition hover:bg-white/5 disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => onMovePhase(phase, 'down')}
                        disabled={phaseIdx === phases.length - 1}
                        aria-label="Move phase down"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-surfaceBorder text-muted transition hover:bg-white/5 disabled:opacity-40"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => onRenamePhase(phase)}
                        className="min-h-[36px] rounded-lg border border-surfaceBorder px-3 text-xs font-medium text-charcoal transition hover:bg-white/5"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeletePhase(phase)}
                        className="min-h-[36px] rounded-lg border border-surfaceBorder px-3 text-xs font-medium text-danger transition hover:bg-danger/10"
                      >
                        Delete
                      </button>
                    </div>
                  )}

                  {isOpen && (
                    <>
                  {/* Phase-anchored draws — owner only (money) */}
                  {isOwner && (
                    <div className="space-y-2 px-4 pb-4">
                      {phaseDraws.map((d) => (
                        <DrawItem
                          key={d.id}
                          draw={d}
                          total={total}
                          ready={phaseComplete}
                          allowRemove
                          onChanged={reloadDraws}
                          setError={setError}
                        />
                      ))}
                      {phaseDraws.length === 0 && (
                        <button
                          type="button"
                          onClick={() => onAddDraw(phase)}
                          className="min-h-[36px] rounded-lg border border-dashed border-surfaceBorder px-3 text-sm font-medium text-amber-700 hover:bg-amber/5"
                        >
                          + Add draw
                        </button>
                      )}
                    </div>
                  )}

                    <ul className="divide-y divide-surfaceBorder/60 border-t border-surfaceBorder/60">
                      {benches.length === 0 && (
                        <li className="px-4 py-3 text-sm text-muted">
                          No benchmarks.
                        </li>
                      )}
                      {benches.map((b, bIdx) => {
                        const benchDraws = drawsByBenchmark.get(b.id) ?? []
                        const isNA = b.not_applicable
                        return (
                          <li
                            key={b.id}
                            className={`flex items-start gap-3 px-4 py-3 ${
                              isNA ? 'opacity-60' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={b.completed}
                              disabled={isNA}
                              onChange={(e) =>
                                onToggleBenchmark(b, e.target.checked)
                              }
                              className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer rounded border-surfaceBorder text-amber accent-amber focus:ring-amber disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={
                                    b.completed
                                      ? 'text-muted line-through'
                                      : isNA
                                        ? 'text-muted'
                                        : b.is_procurement
                                          ? 'font-medium'
                                          : 'text-charcoal'
                                  }
                                  // Procurement (Order:/Schedule:/Confirm:) reads
                                  // as a reminder in calm blue, distinct from work,
                                  // the amber Inspection tag, and the green Draw tag.
                                  style={
                                    b.is_procurement && !b.completed && !isNA
                                      ? { color: '#6BA8E5' }
                                      : undefined
                                  }
                                >
                                  {b.name}
                                </span>
                                {isNA && (
                                  <span className="rounded bg-muted/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                    N/A
                                  </span>
                                )}
                                {b.is_inspection && (
                                  <span className="rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                    Inspection
                                  </span>
                                )}
                                {isOwner &&
                                  benchDraws.map((d) => (
                                    <span
                                      key={d.id}
                                      className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success"
                                    >
                                      Draw · {formatDrawAmountInline(d, total)}
                                    </span>
                                  ))}
                              </div>
                              {b.completed && (
                                <div className="mt-2 space-y-1">
                                  <p className="text-xs text-muted">
                                    Done {fmtDate(b.completed_date)}
                                  </p>
                                  <input
                                    type="date"
                                    value={b.completed_date ?? ''}
                                    onChange={(e) =>
                                      onChangeCompletedDate(b, e.target.value)
                                    }
                                    className="block rounded-lg border border-surfaceBorder bg-field text-ink px-2 py-1 text-sm outline-none focus:border-amber focus:ring-1 focus:ring-amber"
                                  />
                                </div>
                              )}

                              {/* Benchmark-anchored draw details — owner only */}
                              {isOwner && benchDraws.length > 0 && (
                                <div className="mt-2 space-y-2">
                                  {benchDraws.map((d) => (
                                    <DrawItem
                                      key={d.id}
                                      draw={d}
                                      total={total}
                                      ready={b.completed}
                                      onChanged={reloadDraws}
                                      setError={setError}
                                    />
                                  ))}
                                </div>
                              )}

                              {/* No photo/date controls on an N/A item — nothing happened on it. */}
                              {!isNA && (
                                <BenchmarkPhotos
                                  projectId={project.id}
                                  phaseId={b.phase_id}
                                  benchmarkId={b.id}
                                  takenBy={session?.user?.id ?? null}
                                />
                              )}

                              {/* Notes are context, available regardless of status. */}
                              <BenchmarkNotes
                                projectId={project.id}
                                phaseId={b.phase_id}
                                benchmarkId={b.id}
                                authorId={session?.user?.id ?? null}
                              />

                              {/* Owner item controls */}
                              {isOwner && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    aria-pressed={b.is_inspection}
                                    onClick={() => onToggleInspection(b)}
                                    className={`min-h-[36px] rounded-lg border px-2.5 text-[11px] font-semibold uppercase tracking-wide transition ${
                                      b.is_inspection
                                        ? 'border-amber bg-amber/10 text-amber-700'
                                        : 'border-surfaceBorder text-muted hover:bg-white/5'
                                    }`}
                                  >
                                    Inspection
                                  </button>
                                  <button
                                    type="button"
                                    aria-pressed={b.is_procurement}
                                    onClick={() => onToggleProcurement(b)}
                                    className={`min-h-[36px] rounded-lg border px-2.5 text-[11px] font-semibold uppercase tracking-wide transition ${
                                      b.is_procurement
                                        ? 'border-surfaceBorder text-amber-700'
                                        : 'border-surfaceBorder text-muted hover:bg-white/5'
                                    }`}
                                    style={
                                      b.is_procurement
                                        ? { color: '#6BA8E5', borderColor: '#6BA8E5' }
                                        : undefined
                                    }
                                  >
                                    Procurement
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onMoveBenchmark(b, 'up')}
                                    disabled={bIdx === 0}
                                    aria-label="Move item up"
                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-surfaceBorder text-muted transition hover:bg-white/5 disabled:opacity-40"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onMoveBenchmark(b, 'down')}
                                    disabled={bIdx === benches.length - 1}
                                    aria-label="Move item down"
                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-surfaceBorder text-muted transition hover:bg-white/5 disabled:opacity-40"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onRenameBenchmark(b)}
                                    className="min-h-[36px] rounded-lg border border-surfaceBorder px-2.5 text-[11px] font-medium text-charcoal transition hover:bg-white/5"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onDeleteBenchmark(b)}
                                    className="min-h-[36px] rounded-lg border border-surfaceBorder px-2.5 text-[11px] font-medium text-danger transition hover:bg-danger/10"
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* N/A toggle — hidden once the step is completed. */}
                            {!b.completed && (
                              <button
                                type="button"
                                aria-label="Not applicable"
                                aria-pressed={isNA}
                                onClick={() => onToggleNotApplicable(b, !isNA)}
                                className={`mt-0.5 min-h-[44px] shrink-0 rounded-lg border px-3 text-xs font-semibold transition ${
                                  isNA
                                    ? 'border-muted bg-muted/20 text-ink'
                                    : 'border-surfaceBorder text-muted hover:bg-white/5'
                                }`}
                              >
                                N/A
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                    {isOwner && (
                      <div className="border-t border-surfaceBorder/60 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onAddBenchmark(phase.id)}
                          className="min-h-[36px] rounded-lg border border-dashed border-surfaceBorder px-3 text-sm font-medium text-amber-700 transition hover:bg-amber/5"
                        >
                          + Add item
                        </button>
                      </div>
                    )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* Change Orders */}
      <CollapsibleSection
        title="Change Orders"
        summary={changeOrdersSum !== 0 ? formatSigned(changeOrdersSum) : undefined}
      >
        <ChangeOrders
          project={project}
          phases={phases}
          draws={draws}
          createdBy={session?.user?.id ?? null}
          onChanged={onChangeOrdersChanged}
          embedded
        />
      </CollapsibleSection>

      {/* Documents */}
      <CollapsibleSection title="Documents">
        <ProjectDocuments
          projectId={project.id}
          uploadedBy={session?.user?.id ?? null}
          reloadKey={docsReloadKey}
          embedded
        />
      </CollapsibleSection>

      {/* Vendor Docs — received FROM vendors, kept separate from Documents. */}
      <CollapsibleSection title="Vendor Docs">
        <VendorDocs
          projectId={project.id}
          uploadedBy={session?.user?.id ?? null}
          phases={phases}
          embedded
        />
      </CollapsibleSection>

      {/* Selections — New Build only. Read-only view of the client's choices. */}
      {project.type === 'new_build' && (
        <CollapsibleSection
          title="Selections"
          summary={
            selProgress
              ? `${selProgress.answered} / ${selProgress.total}`
              : undefined
          }
        >
          <SelectionsTab
            projectId={project.id}
            shareToken={project.share_token}
            clientEmail={project.client_email}
            embedded
            onCount={(answered, total) =>
              setSelProgress((prev) =>
                prev && prev.answered === answered && prev.total === total
                  ? prev
                  : { answered, total },
              )
            }
          />
        </CollapsibleSection>
      )}

      {/* Assigned Project Managers — owners only (self-gating, hidden for PMs). */}
      <AssignedPMs projectId={project.id} />

      {/* Share links — owner only (read-only progress views for outsiders). */}
      {isOwner && (
        <CollapsibleSection title="Share links">
          <ShareLinks
            projectId={project.id}
            createdBy={session?.user?.id ?? null}
          />
        </CollapsibleSection>
      )}

      {showEdit && (
        <EditProjectModal
          project={project}
          onClose={() => setShowEdit(false)}
          onSaved={loadAll}
        />
      )}
    </div>
  )
}

// Short amount text used inside the green DRAW tag beside a benchmark.
function formatDrawAmountInline(draw: Draw, total: number | null): string {
  if (draw.amount_type === 'percent') {
    const dollars = total != null ? (total * draw.amount_value) / 100 : 0
    return `${draw.amount_value}% (${usd.format(dollars)})`
  }
  return usd.format(draw.amount_value)
}
