import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOrgRole } from '../lib/useOrgRole'
import type { OrgProjectType, ScopeTemplate } from '../lib/types'
import TemplateEditor from '../components/TemplateEditor'

interface TemplateRow extends ScopeTemplate {
  phaseCount: number
}

export default function Templates() {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  const { isOwner, loading: roleLoading } = useOrgRole()

  const [orgId, setOrgId] = useState<string | null>(null)
  const [types, setTypes] = useState<OrgProjectType[]>([])
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string; editable: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    setError(null)
    const [memRes, typesRes, tmplRes] = await Promise.all([
      supabase.from('org_members').select('org_id').eq('user_id', userId).maybeSingle(),
      supabase
        .from('project_types')
        .select('id, name, slug, default_template_id, sequence_order')
        .order('sequence_order', { ascending: true }),
      supabase
        .from('scope_templates')
        .select('id, name, type, is_default, is_custom, org_id')
        .order('name', { ascending: true }),
    ])
    setOrgId((memRes.data?.org_id as string | undefined) ?? null)
    setTypes((typesRes.data ?? []) as OrgProjectType[])

    const tmpls = (tmplRes.data ?? []) as ScopeTemplate[]
    // Phase counts in one query, tallied by template_id.
    const ids = tmpls.map((t) => t.id)
    const countByTemplate: Record<string, number> = {}
    if (ids.length > 0) {
      const { data: ph } = await supabase
        .from('template_phases')
        .select('template_id')
        .in('template_id', ids)
      for (const row of (ph ?? []) as { template_id: string }[]) {
        countByTemplate[row.template_id] = (countByTemplate[row.template_id] ?? 0) + 1
      }
    }
    setTemplates(
      tmpls.map((t) => ({ ...t, phaseCount: countByTemplate[t.id] ?? 0 })),
    )
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  const onNewTemplate = async () => {
    if (!orgId) return
    const name = window.prompt('Template name')?.trim()
    if (!name) return
    if (types.length === 0) {
      setError('No project types to assign a template to.')
      return
    }
    const prompt = `Project type for this template:\n${types
      .map((t, i) => `${i + 1}. ${t.name}`)
      .join('\n')}\n\nEnter a number (1-${types.length}):`
    const choice = window.prompt(prompt, '1')
    if (!choice) return
    const idx = Number(choice) - 1
    if (Number.isNaN(idx) || idx < 0 || idx >= types.length) {
      setError('Invalid project type selection.')
      return
    }
    setError(null)
    const { data, error: insErr } = await supabase
      .from('scope_templates')
      .insert({
        name,
        type: types[idx].slug,
        is_default: false,
        is_custom: true,
        org_id: orgId,
      })
      .select('id, name')
      .single()
    if (insErr || !data) {
      setError(insErr?.message ?? 'Could not create template.')
      return
    }
    await load()
    setEditing({ id: data.id as string, name: data.name as string, editable: true })
  }

  const onDuplicate = async (t: TemplateRow) => {
    if (!orgId) return
    setError(null)
    // 1. New template row.
    const { data: newT, error: tErr } = await supabase
      .from('scope_templates')
      .insert({
        name: `${t.name} (copy)`,
        type: t.type,
        is_default: false,
        is_custom: true,
        org_id: orgId,
      })
      .select('id, name')
      .single()
    if (tErr || !newT) {
      setError(tErr?.message ?? 'Could not duplicate template.')
      return
    }

    // 2. Copy phases (preserving order + fields), tracking old→new ids.
    const { data: phases } = await supabase
      .from('template_phases')
      .select('id, name, sequence_order, nahb_code, default_duration_days')
      .eq('template_id', t.id)
      .order('sequence_order', { ascending: true })
    const phaseRows = (phases ?? []) as {
      id: string
      name: string
      sequence_order: number
      nahb_code: string | null
      default_duration_days: number | null
    }[]

    const newPhaseIdByOld: Record<string, string> = {}
    for (const p of phaseRows) {
      const { data: np, error: npErr } = await supabase
        .from('template_phases')
        .insert({
          template_id: newT.id,
          name: p.name,
          sequence_order: p.sequence_order,
          nahb_code: p.nahb_code,
          default_duration_days: p.default_duration_days,
        })
        .select('id')
        .single()
      if (npErr || !np) {
        setError(npErr?.message ?? 'Could not copy a phase.')
        return
      }
      newPhaseIdByOld[p.id] = np.id as string
    }

    // 3. Copy each phase's benchmarks (preserving order + flags).
    const oldPhaseIds = phaseRows.map((p) => p.id)
    if (oldPhaseIds.length > 0) {
      const { data: benches } = await supabase
        .from('template_benchmarks')
        .select(
          'template_phase_id, name, sequence_order, is_inspection, is_procurement',
        )
        .in('template_phase_id', oldPhaseIds)
        .order('sequence_order', { ascending: true })
      const benchRows = (benches ?? []) as {
        template_phase_id: string
        name: string
        sequence_order: number
        is_inspection: boolean
        is_procurement: boolean
      }[]
      const toInsert = benchRows.flatMap((b) => {
        const newPhaseId = newPhaseIdByOld[b.template_phase_id]
        if (!newPhaseId) return []
        return [
          {
            template_phase_id: newPhaseId,
            name: b.name,
            sequence_order: b.sequence_order,
            is_inspection: b.is_inspection,
            is_procurement: b.is_procurement,
          },
        ]
      })
      if (toInsert.length > 0) {
        const { error: bErr } = await supabase
          .from('template_benchmarks')
          .insert(toInsert)
        if (bErr) {
          setError(bErr.message)
          return
        }
      }
    }

    await load()
    setEditing({ id: newT.id as string, name: newT.name as string, editable: true })
  }

  const onDelete = async (t: TemplateRow) => {
    if (
      !window.confirm(`Delete the template "${t.name}"? This cannot be undone.`)
    )
      return
    setError(null)
    // Remove benchmarks → phases → template.
    const { data: phases } = await supabase
      .from('template_phases')
      .select('id')
      .eq('template_id', t.id)
    const phaseIds = ((phases ?? []) as { id: string }[]).map((p) => p.id)
    if (phaseIds.length > 0) {
      await supabase
        .from('template_benchmarks')
        .delete()
        .in('template_phase_id', phaseIds)
      await supabase.from('template_phases').delete().eq('template_id', t.id)
    }
    const { error: delErr } = await supabase
      .from('scope_templates')
      .delete()
      .eq('id', t.id)
    if (delErr) {
      setError(delErr.message)
      return
    }
    await load()
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (roleLoading || loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-amber border-t-transparent" />
      </div>
    )
  }

  if (!isOwner) {
    return (
      <div className="rounded-2xl bg-surface p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-charcoal">Templates</h1>
        <p className="mt-2 text-sm text-muted">
          Templates are managed by the account owner.
        </p>
      </div>
    )
  }

  if (editing) {
    return (
      <TemplateEditor
        templateId={editing.id}
        templateName={editing.name}
        editable={editing.editable}
        onBack={() => {
          setEditing(null)
          load()
        }}
      />
    )
  }

  const smallBtn =
    'min-h-[36px] rounded-lg border border-surfaceBorder px-3 text-sm font-medium transition hover:bg-white/5'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-charcoal">Templates</h1>
        <button
          type="button"
          onClick={onNewTemplate}
          className="min-h-[44px] rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700"
        >
          + New custom template
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {types.map((pt) => {
        const ofType = templates.filter((t) => t.type === pt.slug)
        const preloaded = ofType.filter((t) => !t.is_custom)
        const custom = ofType.filter((t) => t.is_custom)
        return (
          <section key={pt.id} className="rounded-2xl bg-surface p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-charcoal">{pt.name}</h2>

            <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Preloaded
            </h3>
            {preloaded.length === 0 ? (
              <p className="mt-1 text-sm text-muted">None.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {preloaded.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-surfaceBorder bg-field p-3"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {t.name}{' '}
                      <span className="text-muted">
                        ({t.phaseCount} phase{t.phaseCount === 1 ? '' : 's'})
                      </span>
                    </span>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({ id: t.id, name: t.name, editable: false })
                        }
                        className={`${smallBtn} text-charcoal`}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => onDuplicate(t)}
                        className="min-h-[36px] rounded-lg bg-amber px-3 text-sm font-medium text-white transition hover:bg-amber-700"
                      >
                        Duplicate
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
              Custom Templates
            </h3>
            {custom.length === 0 ? (
              <p className="mt-1 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {custom.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-surfaceBorder bg-field p-3"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {t.name}{' '}
                      <span className="text-muted">
                        ({t.phaseCount} phase{t.phaseCount === 1 ? '' : 's'})
                      </span>
                    </span>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({ id: t.id, name: t.name, editable: true })
                        }
                        className={`${smallBtn} text-charcoal`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDuplicate(t)}
                        className="min-h-[36px] rounded-lg bg-amber px-3 text-sm font-medium text-white transition hover:bg-amber-700"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(t)}
                        className={`${smallBtn} text-danger hover:bg-danger/10`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
