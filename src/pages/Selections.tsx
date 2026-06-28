import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOrgRole } from '../lib/useOrgRole'
import type { SelectionTemplate } from '../lib/types'
import SelectionListEditor from '../components/SelectionListEditor'

interface ListRow extends SelectionTemplate {
  questionCount: number
}

export default function Selections() {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  const { isOwner, loading: roleLoading } = useOrgRole()

  const [orgId, setOrgId] = useState<string | null>(null)
  const [lists, setLists] = useState<ListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  )

  const load = useCallback(async () => {
    if (!userId) return
    setError(null)
    const [memRes, listRes] = await Promise.all([
      supabase
        .from('org_members')
        .select('org_id')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('selection_templates')
        .select('id, name, is_default, created_at')
        .order('name', { ascending: true }),
    ])
    setOrgId((memRes.data?.org_id as string | undefined) ?? null)

    const rows = (listRes.data ?? []) as SelectionTemplate[]
    const ids = rows.map((r) => r.id)
    const countByList: Record<string, number> = {}
    if (ids.length > 0) {
      const { data: cats } = await supabase
        .from('catalog_categories')
        .select('selection_template_id')
        .in('selection_template_id', ids)
      for (const c of (cats ?? []) as { selection_template_id: string }[]) {
        countByList[c.selection_template_id] =
          (countByList[c.selection_template_id] ?? 0) + 1
      }
    }
    setLists(
      rows.map((r) => ({ ...r, questionCount: countByList[r.id] ?? 0 })),
    )
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  const onNewList = async () => {
    if (!orgId) return
    const name = window.prompt('Selection list name')?.trim()
    if (!name) return
    setError(null)
    const { data, error: e } = await supabase
      .from('selection_templates')
      .insert({ org_id: orgId, name, is_default: false })
      .select('id, name')
      .single()
    if (e || !data) {
      setError(e?.message ?? 'Could not create list.')
      return
    }
    await load()
    setEditing({ id: data.id as string, name: data.name as string })
  }

  const onDuplicate = async (list: ListRow) => {
    if (!orgId) return
    setError(null)
    const { data: newList, error: e } = await supabase
      .from('selection_templates')
      .insert({ org_id: orgId, name: `${list.name} (copy)`, is_default: false })
      .select('id, name')
      .single()
    if (e || !newList) {
      setError(e?.message ?? 'Could not duplicate list.')
      return
    }
    // Copy all questions to the new list.
    const { data: cats } = await supabase
      .from('catalog_categories')
      .select('section, sort_order, label, help, qtype, options, upcharge_note')
      .eq('selection_template_id', list.id)
      .order('sort_order', { ascending: true })
    const rows = (cats ?? []) as {
      section: string
      sort_order: number
      label: string
      help: string | null
      qtype: string
      options: string[] | null
      upcharge_note: string | null
    }[]
    if (rows.length > 0) {
      const toInsert = rows.map((c) => ({
        selection_template_id: newList.id,
        section: c.section,
        sort_order: c.sort_order,
        label: c.label,
        help: c.help,
        qtype: c.qtype,
        options: c.options,
        upcharge_note: c.upcharge_note,
      }))
      const { error: ce } = await supabase
        .from('catalog_categories')
        .insert(toInsert)
      if (ce) {
        setError(ce.message)
        return
      }
    }
    await load()
    setEditing({ id: newList.id as string, name: newList.name as string })
  }

  const onDelete = async (list: ListRow) => {
    setError(null)
    // Guard: don't delete a list still referenced by a project.
    const { count } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('selection_template_id', list.id)
    if ((count ?? 0) > 0) {
      setError(
        `"${list.name}" is in use by ${count} project${
          count === 1 ? '' : 's'
        } and can't be deleted. Reassign those projects first.`,
      )
      return
    }
    if (
      !window.confirm(`Delete the list "${list.name}" and all its questions?`)
    )
      return
    await supabase
      .from('catalog_categories')
      .delete()
      .eq('selection_template_id', list.id)
    const { error: e } = await supabase
      .from('selection_templates')
      .delete()
      .eq('id', list.id)
    if (e) {
      setError(e.message)
      return
    }
    await load()
  }

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
        <h1 className="text-lg font-semibold text-charcoal">Selections</h1>
        <p className="mt-2 text-sm text-muted">
          Selection lists are managed by the account owner.
        </p>
      </div>
    )
  }

  if (editing) {
    return (
      <SelectionListEditor
        listId={editing.id}
        listName={editing.name}
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
        <h1 className="text-2xl font-bold text-charcoal">Selection Lists</h1>
        <button
          type="button"
          onClick={onNewList}
          className="min-h-[44px] rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700"
        >
          + New list
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {lists.length === 0 ? (
        <p className="text-sm text-muted">No selection lists yet.</p>
      ) : (
        <ul className="space-y-2">
          {lists.map((list) => (
            <li
              key={list.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-surfaceBorder bg-surface p-4 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <span className="font-medium text-charcoal">{list.name}</span>
                {list.is_default && (
                  <span className="ml-2 rounded-full bg-amber/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                    Default
                  </span>
                )}
                <span className="ml-2 text-sm text-muted">
                  ({list.questionCount} question
                  {list.questionCount === 1 ? '' : 's'})
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setEditing({ id: list.id, name: list.name })}
                  className={`${smallBtn} text-charcoal`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDuplicate(list)}
                  className="min-h-[36px] rounded-lg bg-amber px-3 text-sm font-medium text-white transition hover:bg-amber-700"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(list)}
                  className={`${smallBtn} text-danger hover:bg-danger/10`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
