import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TemplateBenchmark, TemplatePhase } from '../lib/types'

interface Props {
  templateId: string
  templateName: string
  /** Custom templates are editable; preloaded ones are view-only. */
  editable: boolean
  onBack: () => void
}

export default function TemplateEditor({
  templateId,
  templateName,
  editable,
  onBack,
}: Props) {
  const [phases, setPhases] = useState<TemplatePhase[]>([])
  const [benchByPhase, setBenchByPhase] = useState<
    Record<string, TemplateBenchmark[]>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const { data: ph, error: phErr } = await supabase
      .from('template_phases')
      .select(
        'id, template_id, name, sequence_order, nahb_code, default_duration_days',
      )
      .eq('template_id', templateId)
      .order('sequence_order', { ascending: true })
    if (phErr) {
      setError(phErr.message)
      setLoading(false)
      return
    }
    const phaseRows = (ph ?? []) as TemplatePhase[]
    setPhases(phaseRows)

    const ids = phaseRows.map((p) => p.id)
    if (ids.length > 0) {
      const { data: bm } = await supabase
        .from('template_benchmarks')
        .select(
          'id, template_phase_id, name, sequence_order, is_inspection, is_procurement',
        )
        .in('template_phase_id', ids)
        .order('sequence_order', { ascending: true })
      const grouped: Record<string, TemplateBenchmark[]> = {}
      for (const b of (bm ?? []) as TemplateBenchmark[]) {
        ;(grouped[b.template_phase_id] ||= []).push(b)
      }
      setBenchByPhase(grouped)
    } else {
      setBenchByPhase({})
    }
    setLoading(false)
  }, [templateId])

  useEffect(() => {
    load()
  }, [load])

  // Swap sequence_order via a temp value (max sibling + 1) so a unique
  // ordering key is never transiently violated.
  const swapSequence = async (
    table: 'template_phases' | 'template_benchmarks',
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

  // ── Phase handlers ────────────────────────────────────────────────────────
  const addPhase = async () => {
    const name = window.prompt('Phase name')?.trim()
    if (!name) return
    setError(null)
    const maxSeq = phases.reduce((m, p) => Math.max(m, p.sequence_order ?? 0), 0)
    const { error: insErr } = await supabase.from('template_phases').insert({
      template_id: templateId,
      name,
      sequence_order: maxSeq + 1,
      nahb_code: null,
      default_duration_days: 7,
    })
    if (insErr) setError(insErr.message)
    else await load()
  }

  const renamePhase = async (p: TemplatePhase) => {
    const name = window.prompt('Rename phase', p.name)?.trim()
    if (!name || name === p.name) return
    setError(null)
    const { error: e } = await supabase
      .from('template_phases')
      .update({ name })
      .eq('id', p.id)
    if (e) setError(e.message)
    else await load()
  }

  const deletePhase = async (p: TemplatePhase) => {
    if (!window.confirm('Delete this phase and all its items?')) return
    setError(null)
    const { error: bErr } = await supabase
      .from('template_benchmarks')
      .delete()
      .eq('template_phase_id', p.id)
    if (bErr) {
      setError(bErr.message)
      return
    }
    const { error: pErr } = await supabase
      .from('template_phases')
      .delete()
      .eq('id', p.id)
    if (pErr) setError(pErr.message)
    else await load()
  }

  const movePhase = async (p: TemplatePhase, dir: 'up' | 'down') => {
    const idx = phases.findIndex((x) => x.id === p.id)
    const j = dir === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || j < 0 || j >= phases.length) return
    setError(null)
    const tempSeq =
      phases.reduce((m, x) => Math.max(m, x.sequence_order ?? 0), 0) + 1
    const err = await swapSequence('template_phases', p, phases[j], tempSeq)
    if (err) setError(err)
    else await load()
  }

  const updateDuration = async (p: TemplatePhase, value: string) => {
    const days = Math.max(1, Math.round(Number(value) || 0))
    if (days === (p.default_duration_days ?? 0)) return
    setError(null)
    const { error: e } = await supabase
      .from('template_phases')
      .update({ default_duration_days: days })
      .eq('id', p.id)
    if (e) setError(e.message)
    else await load()
  }

  // ── Benchmark handlers ────────────────────────────────────────────────────
  const addBenchmark = async (phaseId: string) => {
    const name = window.prompt('Item name')?.trim()
    if (!name) return
    setError(null)
    const arr = benchByPhase[phaseId] ?? []
    const maxSeq = arr.reduce((m, x) => Math.max(m, x.sequence_order ?? 0), 0)
    const { error: e } = await supabase.from('template_benchmarks').insert({
      template_phase_id: phaseId,
      name,
      sequence_order: maxSeq + 1,
      is_inspection: false,
      is_procurement: false,
    })
    if (e) setError(e.message)
    else await load()
  }

  const renameBenchmark = async (b: TemplateBenchmark) => {
    const name = window.prompt('Rename item', b.name)?.trim()
    if (!name || name === b.name) return
    setError(null)
    const { error: e } = await supabase
      .from('template_benchmarks')
      .update({ name })
      .eq('id', b.id)
    if (e) setError(e.message)
    else await load()
  }

  const deleteBenchmark = async (b: TemplateBenchmark) => {
    if (!window.confirm('Delete this item?')) return
    setError(null)
    const { error: e } = await supabase
      .from('template_benchmarks')
      .delete()
      .eq('id', b.id)
    if (e) setError(e.message)
    else await load()
  }

  const moveBenchmark = async (b: TemplateBenchmark, dir: 'up' | 'down') => {
    const arr = benchByPhase[b.template_phase_id] ?? []
    const idx = arr.findIndex((x) => x.id === b.id)
    const j = dir === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || j < 0 || j >= arr.length) return
    setError(null)
    const tempSeq =
      arr.reduce((m, x) => Math.max(m, x.sequence_order ?? 0), 0) + 1
    const err = await swapSequence('template_benchmarks', b, arr[j], tempSeq)
    if (err) setError(err)
    else await load()
  }

  const toggleFlag = async (
    b: TemplateBenchmark,
    field: 'is_inspection' | 'is_procurement',
  ) => {
    setError(null)
    const { error: e } = await supabase
      .from('template_benchmarks')
      .update({ [field]: !b[field] })
      .eq('id', b.id)
    if (e) setError(e.message)
    else await load()
  }

  const iconBtn =
    'flex h-9 w-9 items-center justify-center rounded-lg border border-surfaceBorder text-muted transition hover:bg-white/5 disabled:opacity-40'
  const smallBtn =
    'min-h-[36px] rounded-lg border border-surfaceBorder px-2.5 text-[11px] font-medium transition hover:bg-white/5'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-medium text-amber-700"
        >
          ← All templates
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-charcoal">{templateName}</h1>
        {!editable && (
          <span className="rounded-full border border-surfaceBorder px-2.5 py-0.5 text-xs font-medium text-muted">
            View only (preloaded)
          </span>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {editable && (
        <button
          type="button"
          onClick={addPhase}
          className="min-h-[40px] rounded-lg border border-dashed border-surfaceBorder px-3 text-sm font-medium text-amber-700 transition hover:bg-amber/5"
        >
          + Add phase
        </button>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      ) : phases.length === 0 ? (
        <p className="text-sm text-muted">No phases yet.</p>
      ) : (
        <div className="space-y-3">
          {phases.map((p, pIdx) => {
            const items = benchByPhase[p.id] ?? []
            return (
              <div
                key={p.id}
                className="rounded-xl border border-surfaceBorder bg-surface p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 flex-1 font-semibold text-charcoal">
                    {p.name}
                  </h3>
                  <div className="flex shrink-0 items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-muted">
                      <span>Days</span>
                      <input
                        type="number"
                        min={1}
                        defaultValue={p.default_duration_days ?? 7}
                        disabled={!editable}
                        onBlur={(e) => updateDuration(p, e.target.value)}
                        className="w-16 rounded-lg border border-surfaceBorder bg-field px-2 py-1 text-sm text-ink outline-none focus:border-amber focus:ring-1 focus:ring-amber disabled:opacity-60"
                      />
                    </label>
                  </div>
                </div>

                {editable && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => movePhase(p, 'up')}
                      disabled={pIdx === 0}
                      aria-label="Move phase up"
                      className={iconBtn}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => movePhase(p, 'down')}
                      disabled={pIdx === phases.length - 1}
                      aria-label="Move phase down"
                      className={iconBtn}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => renamePhase(p)}
                      className={`${smallBtn} text-charcoal`}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePhase(p)}
                      className={`${smallBtn} text-danger hover:bg-danger/10`}
                    >
                      Delete
                    </button>
                  </div>
                )}

                <ul className="mt-3 divide-y divide-surfaceBorder/60 border-t border-surfaceBorder/60">
                  {items.length === 0 && (
                    <li className="py-2 text-sm text-muted">No items.</li>
                  )}
                  {items.map((b, bIdx) => (
                    <li key={b.id} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            b.is_procurement ? 'font-medium' : 'text-charcoal'
                          }
                          style={
                            b.is_procurement ? { color: '#6BA8E5' } : undefined
                          }
                        >
                          {b.name}
                        </span>
                        {b.is_inspection && (
                          <span className="rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                            Inspection
                          </span>
                        )}
                      </div>

                      {editable && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            aria-pressed={b.is_inspection}
                            onClick={() => toggleFlag(b, 'is_inspection')}
                            className={`${smallBtn} uppercase tracking-wide ${
                              b.is_inspection
                                ? 'border-amber bg-amber/10 text-amber-700'
                                : 'text-muted'
                            }`}
                          >
                            Inspection
                          </button>
                          <button
                            type="button"
                            aria-pressed={b.is_procurement}
                            onClick={() => toggleFlag(b, 'is_procurement')}
                            className={`${smallBtn} uppercase tracking-wide ${
                              b.is_procurement ? '' : 'text-muted'
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
                            onClick={() => moveBenchmark(b, 'up')}
                            disabled={bIdx === 0}
                            aria-label="Move item up"
                            className={iconBtn}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveBenchmark(b, 'down')}
                            disabled={bIdx === items.length - 1}
                            aria-label="Move item down"
                            className={iconBtn}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => renameBenchmark(b)}
                            className={`${smallBtn} text-charcoal`}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteBenchmark(b)}
                            className={`${smallBtn} text-danger hover:bg-danger/10`}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {editable && (
                  <button
                    type="button"
                    onClick={() => addBenchmark(p.id)}
                    className="mt-3 min-h-[36px] rounded-lg border border-dashed border-surfaceBorder px-3 text-sm font-medium text-amber-700 transition hover:bg-amber/5"
                  >
                    + Add item
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
