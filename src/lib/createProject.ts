import { supabase } from './supabase'
import type {
  NewProjectInput,
  ProjectType,
  TemplateBenchmark,
  TemplateDraw,
  TemplatePhase,
} from './types'

/** Local YYYY-MM-DD for "today" (used as a fallback project start date). */
function todayISO(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

/** Add `days` to a YYYY-MM-DD date string, returning YYYY-MM-DD. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`)
}

/**
 * Create a project. For new builds, copy the default scope template into live
 * phases / benchmarks / draws. Renovations are created as a bare project row.
 * Returns the new project's id.
 */
export async function createProject(
  input: NewProjectInput & { type: ProjectType },
): Promise<string> {
  // 1. Insert the project row.
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .insert({
      name: input.name,
      type: input.type,
      client_name: input.client_name,
      address: input.address,
      total_amount: input.total_amount,
      start_date: input.start_date,
      target_completion_date: input.target_completion_date,
    })
    .select('id, start_date')
    .single()

  if (projectErr || !project) {
    fail('Could not create project', projectErr?.message ?? 'no row returned')
  }

  // 3. Renovations: nothing more to do.
  if (input.type !== 'new_build') {
    return project.id
  }

  // 2a. Pick the new-build template by exact name based on the chosen
  // foundation. Each foundation type has its own scope template.
  const TEMPLATE_NAME_BY_FOUNDATION: Record<string, string> = {
    slab: 'New Build — Slab',
    crawlspace: 'New Build — Crawlspace',
  }
  const templateName = input.foundation
    ? TEMPLATE_NAME_BY_FOUNDATION[input.foundation]
    : undefined
  if (!templateName) {
    fail('Could not load template', 'a foundation type is required for new builds')
  }

  const { data: template, error: templateErr } = await supabase
    .from('scope_templates')
    .select('id')
    .eq('type', 'new_build')
    .eq('name', templateName)
    .maybeSingle()

  if (templateErr) {
    fail('Could not load template', templateErr.message)
  }
  // No matching template configured — leave the project as a bare row.
  if (!template) {
    return project.id
  }

  const { data: templatePhases, error: tpErr } = await supabase
    .from('template_phases')
    .select('id, template_id, name, sequence_order, nahb_code, default_duration_days')
    .eq('template_id', template.id)
    .order('sequence_order', { ascending: true })

  if (tpErr) fail('Could not load template phases', tpErr.message)
  const phases = (templatePhases ?? []) as TemplatePhase[]

  if (phases.length === 0) return project.id

  const phaseIds = phases.map((p) => p.id)

  const { data: templateBenchmarks, error: tbErr } = await supabase
    .from('template_benchmarks')
    .select('id, template_phase_id, name, sequence_order, is_inspection, is_procurement')
    .in('template_phase_id', phaseIds)
    .order('sequence_order', { ascending: true })

  if (tbErr) fail('Could not load template benchmarks', tbErr.message)
  const benchmarks = (templateBenchmarks ?? []) as TemplateBenchmark[]

  const { data: templateDraws, error: tdErr } = await supabase
    .from('template_draws')
    .select(
      'id, template_id, label, sequence_order, template_phase_id, template_benchmark_id, amount_type, amount_value',
    )
    .eq('template_id', template.id)
    .order('sequence_order', { ascending: true })

  if (tdErr) fail('Could not load template draws', tdErr.message)
  const draws = (templateDraws ?? []) as TemplateDraw[]

  // 2b. Insert phases, laying them end-to-end from the project start date.
  let cursor = project.start_date || todayISO()
  const phaseRows = phases.map((tp) => {
    const start = cursor
    const duration = tp.default_duration_days ?? 1
    const end = addDays(start, duration)
    cursor = end // next phase begins where this one ends
    return {
      project_id: project.id,
      name: tp.name,
      sequence_order: tp.sequence_order,
      nahb_code: tp.nahb_code,
      target_start: start,
      target_end: end,
      baseline_start: start,
      baseline_end: end,
    }
  })

  const { data: insertedPhases, error: phaseInsErr } = await supabase
    .from('phases')
    .insert(phaseRows)
    .select('id, sequence_order')

  if (phaseInsErr || !insertedPhases) {
    fail('Could not create phases', phaseInsErr?.message ?? 'no rows returned')
  }

  // sequence_order is unique within a project, so it's a safe join key.
  const newPhaseIdBySeq = new Map<number, string>(
    insertedPhases.map((p) => [p.sequence_order as number, p.id as string]),
  )
  const phaseIdByTemplatePhaseId = new Map<string, string>()
  for (const tp of phases) {
    const newId = newPhaseIdBySeq.get(tp.sequence_order)
    if (newId) phaseIdByTemplatePhaseId.set(tp.id, newId)
  }

  // 2c. Insert benchmarks per phase, tracking template->live id mapping.
  const benchmarkIdByTemplateBenchmarkId = new Map<string, string>()
  for (const tp of phases) {
    const newPhaseId = phaseIdByTemplatePhaseId.get(tp.id)
    if (!newPhaseId) continue
    const phaseBenchmarks = benchmarks
      .filter((b) => b.template_phase_id === tp.id)
      .sort((a, b) => a.sequence_order - b.sequence_order)
    if (phaseBenchmarks.length === 0) continue

    const rows = phaseBenchmarks.map((b) => ({
      phase_id: newPhaseId,
      name: b.name,
      sequence_order: b.sequence_order,
      is_inspection: b.is_inspection,
      is_procurement: b.is_procurement,
    }))

    const { data: insertedBenchmarks, error: benchErr } = await supabase
      .from('benchmarks')
      .insert(rows)
      .select('id, sequence_order')

    if (benchErr || !insertedBenchmarks) {
      fail('Could not create benchmarks', benchErr?.message ?? 'no rows returned')
    }

    const idBySeq = new Map<number, string>(
      insertedBenchmarks.map((x) => [x.sequence_order as number, x.id as string]),
    )
    for (const b of phaseBenchmarks) {
      const newId = idBySeq.get(b.sequence_order)
      if (newId) benchmarkIdByTemplateBenchmarkId.set(b.id, newId)
    }
  }

  // 2d. Insert draws, resolving anchors through the phase/benchmark maps.
  if (draws.length > 0) {
    const drawRows = draws.map((d) => ({
      project_id: project.id,
      label: d.label,
      sequence_order: d.sequence_order,
      phase_id: d.template_phase_id
        ? phaseIdByTemplatePhaseId.get(d.template_phase_id) ?? null
        : null,
      benchmark_id: d.template_benchmark_id
        ? benchmarkIdByTemplateBenchmarkId.get(d.template_benchmark_id) ?? null
        : null,
      amount_type: d.amount_type,
      amount_value: d.amount_value,
    }))

    const { error: drawErr } = await supabase.from('draws').insert(drawRows)
    if (drawErr) fail('Could not create draws', drawErr.message)
  }

  return project.id
}
