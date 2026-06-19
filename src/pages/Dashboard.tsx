import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type {
  Project,
  ProjectLastActivity,
  ProjectProgress,
  ProjectType,
  Selection,
} from '../lib/types'
import { daysSince, formatDate } from '../lib/format'
import NewProjectModal from '../components/NewProjectModal'
import StatusNote from '../components/StatusNote'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const TYPE_LABELS: Record<ProjectType, string> = {
  new_build: 'New Build',
  renovation: 'Renovation',
}

function ActivityLine({ lastActivity }: { lastActivity: string | null }) {
  const days = daysSince(lastActivity)

  // Age buckets: 0–5 neutral, >5–10 yellow, >10 red.
  let chip: { word: string; cls: string } | null = null
  if (days != null) {
    if (days > 10) {
      chip = { word: 'Stale', cls: 'bg-danger/15 text-danger' }
    } else if (days > 5) {
      chip = { word: 'Check in', cls: 'bg-warning/15 text-warning' }
    }
  }

  const agoLabel =
    days == null ? '' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span>
        Last activity: {formatDate(lastActivity)}
        {agoLabel && ` · ${agoLabel}`}
      </span>
      {chip && (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${chip.cls}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              chip.word === 'Stale' ? 'bg-danger' : 'bg-warning'
            }`}
            aria-hidden
          />
          {chip.word}
        </span>
      )}
    </div>
  )
}

function ProgressLine({ progress }: { progress: ProjectProgress | undefined }) {
  const pct = Math.min(100, Math.max(0, Math.round(progress?.overall_pct ?? 0)))
  // current_phase null = nothing left to do; otherwise show the phase name.
  const phaseLabel = progress?.current_phase ?? 'All phases complete'

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-9 shrink-0 text-right text-xs font-medium text-muted">
          {pct}%
        </span>
      </div>
      <p className="mt-1 truncate text-xs text-muted">{phaseLabel}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  return (
    <span className="rounded-full bg-amber/10 px-2.5 py-0.5 text-xs font-medium capitalize text-amber-700">
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function ProjectCard({
  project,
  lastActivity,
  progress,
  selectionCount,
  catalogTotal,
  onDelete,
  onUpdated,
}: {
  project: Project
  lastActivity: string | null
  progress: ProjectProgress | undefined
  selectionCount: number
  catalogTotal: number
  onDelete: (project: Project) => void
  onUpdated: () => void
}) {
  return (
    <div className="relative rounded-xl border border-surfaceBorder bg-surface shadow-sm transition hover:border-amber/40 hover:shadow">
      {/* Status headline band — editable, kept outside the navigation link. */}
      <div className="p-3 pb-0">
        <StatusNote
          projectId={project.id}
          note={project.status_note}
          updatedAt={project.status_note_updated_at}
          onSaved={onUpdated}
        />
      </div>
      <Link
        to={`/project/${project.id}`}
        className="block min-h-[44px] px-4 pb-4 pr-12 pt-3"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-charcoal">{project.name}</h3>
          <StatusBadge status={project.status} />
        </div>
        {project.client_name && (
          <p className="mt-1 text-sm text-muted">{project.client_name}</p>
        )}
        {project.address && (
          <p className="text-sm text-muted">{project.address}</p>
        )}
        {project.total_amount != null && (
          <p className="mt-2 text-sm font-medium text-charcoal">
            {usd.format(project.total_amount)}
          </p>
        )}
        <ProgressLine progress={progress} />
        {project.type === 'new_build' && (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber/10 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            Selections: {selectionCount} / {catalogTotal}
          </p>
        )}
        <ActivityLine lastActivity={lastActivity} />
      </Link>
      <button
        type="button"
        aria-label={`Delete ${project.name}`}
        title="Delete project"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDelete(project)
        }}
        className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-danger/15 hover:text-danger"
      >
        {/* trash icon */}
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
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </button>
    </div>
  )
}

function CompletedCard({
  project,
  onDelete,
}: {
  project: Project
  onDelete: (project: Project) => void
}) {
  return (
    <div className="relative">
      <Link
        to={`/project/${project.id}`}
        className="block min-h-[44px] rounded-xl border border-surfaceBorder bg-surface p-4 pr-12 shadow-sm transition hover:border-amber/40 hover:shadow"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-charcoal">{project.name}</h3>
          <span className="shrink-0 rounded-full border border-surfaceBorder px-2 py-0.5 text-xs font-medium text-muted">
            {TYPE_LABELS[project.type]}
          </span>
        </div>
        {project.address && (
          <p className="mt-1 text-sm text-muted">{project.address}</p>
        )}
        {project.total_amount != null && (
          <p className="mt-2 text-sm font-medium text-charcoal">
            {usd.format(project.total_amount)}
          </p>
        )}
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
          Completed {formatDate(project.completed_at)}
        </span>
      </Link>
      <button
        type="button"
        aria-label={`Delete ${project.name}`}
        title="Delete project"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDelete(project)
        }}
        className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-danger/15 hover:text-danger"
      >
        {/* trash icon */}
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
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </button>
    </div>
  )
}

interface SectionProps {
  title: string
  type: ProjectType
  projects: Project[]
  lastActivityByProject: Record<string, string | null>
  progressByProject: Record<string, ProjectProgress>
  selectionsByProject: Record<string, number>
  catalogTotal: number
  onAdd: () => void
  onDelete: (project: Project) => void
  onUpdated: () => void
}

function Section({
  title,
  type,
  projects,
  lastActivityByProject,
  progressByProject,
  selectionsByProject,
  catalogTotal,
  onAdd,
  onDelete,
  onUpdated,
}: SectionProps) {
  const addLabel = type === 'new_build' ? '+ New Build' : '+ Renovation'
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        <button
          type="button"
          onClick={onAdd}
          className="min-h-[36px] rounded-lg bg-accent px-3 text-sm font-medium text-white transition hover:bg-accentHover"
        >
          {addLabel}
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surfaceBorder bg-surface/40 px-4 py-3 text-center">
          <p className="text-sm text-muted">
            No {title.toLowerCase()} yet. Tap “{addLabel}” to add one.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              lastActivity={lastActivityByProject[p.id] ?? null}
              progress={progressByProject[p.id]}
              selectionCount={selectionsByProject[p.id] ?? 0}
              catalogTotal={catalogTotal}
              onDelete={onDelete}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [lastActivityByProject, setLastActivityByProject] = useState<
    Record<string, string | null>
  >({})
  const [progressByProject, setProgressByProject] = useState<
    Record<string, ProjectProgress>
  >({})
  // Count of answered-or-N/A selections per project (New Build counter).
  const [selectionsByProject, setSelectionsByProject] = useState<
    Record<string, number>
  >({})
  const [catalogTotal, setCatalogTotal] = useState(31)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalType, setModalType] = useState<ProjectType | null>(null)
  const [view, setView] = useState<'active' | 'completed'>('active')

  const load = useCallback(async () => {
    setError(null)

    // Fetch projects and the activity view in parallel. The view gives us the
    // most recent activity per project in a single query (mapped by id below),
    // rather than one request per card.
    const [projectsRes, activityRes, progressRes, selectionsRes, catalogRes] =
      await Promise.all([
        supabase
          .from('projects')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase.from('project_last_activity').select('*'),
        supabase.from('project_progress').select('*'),
        // One query for every card's counter: tally answered-or-N/A per project.
        supabase.from('selections').select('project_id, value, is_na'),
        supabase
          .from('catalog_categories')
          .select('id', { count: 'exact', head: true }),
      ])

    if (projectsRes.error) {
      setError(projectsRes.error.message)
      setProjects([])
    } else {
      setProjects((projectsRes.data ?? []) as Project[])
    }

    if (!activityRes.error) {
      const rows = (activityRes.data ?? []) as ProjectLastActivity[]
      const map: Record<string, string | null> = {}
      for (const row of rows) {
        map[row.project_id] = row.last_activity
      }
      setLastActivityByProject(map)
    }

    if (!progressRes.error) {
      const rows = (progressRes.data ?? []) as ProjectProgress[]
      const map: Record<string, ProjectProgress> = {}
      for (const row of rows) {
        map[row.project_id] = row
      }
      setProgressByProject(map)
    }

    if (!selectionsRes.error) {
      const rows = (selectionsRes.data ?? []) as Pick<
        Selection,
        'project_id' | 'value' | 'is_na'
      >[]
      const map: Record<string, number> = {}
      for (const row of rows) {
        const answered = row.is_na || (!!row.value && row.value.trim() !== '')
        if (answered) map[row.project_id] = (map[row.project_id] ?? 0) + 1
      }
      setSelectionsByProject(map)
    }

    if (catalogRes.count != null) setCatalogTotal(catalogRes.count)

    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = async (project: Project) => {
    const ok = window.confirm(
      `Delete "${project.name}"? This permanently removes the project and its phases, benchmarks, and draws.`,
    )
    if (!ok) return
    const { error } = await supabase.from('projects').delete().eq('id', project.id)
    if (error) {
      setError(error.message)
      return
    }
    load()
  }

  // Active view shows everything that isn't complete (active + on_hold).
  const activeProjects = projects.filter((p) => p.status !== 'complete')
  const newBuilds = activeProjects.filter((p) => p.type === 'new_build')
  const renovations = activeProjects.filter((p) => p.type === 'renovation')

  // Completed view: a single combined list, newest completion first.
  const completedProjects = projects
    .filter((p) => p.status === 'complete')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  return (
    <div>
      {/* Active / Completed toggle */}
      <div className="mb-6 inline-flex rounded-xl bg-field p-1">
        <button
          type="button"
          onClick={() => setView('active')}
          className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold transition ${
            view === 'active'
              ? 'bg-accent text-white shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setView('completed')}
          className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold transition ${
            view === 'completed'
              ? 'bg-accent text-white shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          Completed
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      ) : error ? (
        <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          Failed to load projects: {error}
        </p>
      ) : view === 'active' ? (
        <>
          <Section
            title="New Builds"
            type="new_build"
            projects={newBuilds}
            lastActivityByProject={lastActivityByProject}
            progressByProject={progressByProject}
            selectionsByProject={selectionsByProject}
            catalogTotal={catalogTotal}
            onAdd={() => setModalType('new_build')}
            onDelete={handleDelete}
            onUpdated={load}
          />
          <Section
            title="Renovations"
            type="renovation"
            projects={renovations}
            lastActivityByProject={lastActivityByProject}
            progressByProject={progressByProject}
            selectionsByProject={selectionsByProject}
            catalogTotal={catalogTotal}
            onAdd={() => setModalType('renovation')}
            onDelete={handleDelete}
            onUpdated={load}
          />
        </>
      ) : (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold text-charcoal">Completed</h2>
          {completedProjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-surfaceBorder bg-surface/40 p-6 text-center">
              <p className="text-sm text-muted">No completed projects yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {completedProjects.map((p) => (
                <CompletedCard key={p.id} project={p} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </section>
      )}

      {modalType && (
        <NewProjectModal
          type={modalType}
          onClose={() => setModalType(null)}
          onCreated={load}
        />
      )}
    </div>
  )
}
