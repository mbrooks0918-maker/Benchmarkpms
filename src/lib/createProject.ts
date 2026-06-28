import { supabase } from './supabase'
import { addDays, todayISO } from './dates'
import type {
  NewProjectInput,
  TemplateBenchmark,
  TemplateDraw,
  TemplatePhase,
} from './types'

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`)
}

/**
 * Create a project of a given type (slug). If the type has a default template
 * (`templateId`), copy its phases / benchmarks / draws into the live project;
 * a null templateId creates a bare project (no phases). Returns the new id.
 */
export async function createProject(
  input: NewProjectInput & { typeSlug: string; templateId: string | null },
): Promise<string> {
  // 1. Insert the project row, tagged with the type's slug.
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .insert({
      name: input.name,
      type: input.typeSlug,
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

  // 2. No template for this type (e.g. Renovation) → bare project, done.
  if (!input.templateId) {
    return project.id
  }
  const templateId = input.templateId

  const { data: templatePhases, error: tpErr } = await supabase
    .from('template_phases')
    .select('id, template_id, name, sequence_order, nahb_code, default_duration_days')
    .eq('template_id', templateId)
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
    .eq('template_id', templateId)
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
