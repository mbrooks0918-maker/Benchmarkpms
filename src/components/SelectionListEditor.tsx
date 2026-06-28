import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { CatalogCategory } from '../lib/types'

interface Props {
  listId: string
  listName: string
  onBack: () => void
}

type QType = 'text' | 'radio' | 'yesno'

const QTYPE_LABELS: Record<string, string> = {
  text: 'Text',
  radio: 'Choice (radio)',
  yesno: 'Yes / No',
}

const inputClass =
  'min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber'

export default function SelectionListEditor({
  listId,
  listName,
  onBack,
}: Props) {
  const [questions, setQuestions] = useState<CatalogCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state.
  const [fSection, setFSection] = useState('')
  const [fLabel, setFLabel] = useState('')
  const [fHelp, setFHelp] = useState('')
  const [fQtype, setFQtype] = useState<QType>('text')
  const [fOptions, setFOptions] = useState<string[]>([])
  const [fOptionDraft, setFOptionDraft] = useState('')
  const [fUpcharge, setFUpcharge] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const { data, error: e } = await supabase
      .from('catalog_categories')
      .select(
        'id, selection_template_id, section, sort_order, label, help, qtype, options, upcharge_note',
      )
      .eq('selection_template_id', listId)
      .order('sort_order', { ascending: true })
    if (e) {
      setError(e.message)
      setLoading(false)
      return
    }
    setQuestions((data ?? []) as CatalogCategory[])
    setLoading(false)
  }, [listId])

  useEffect(() => {
    load()
  }, [load])

  // Group by section, preserving first-seen section order.
  const sections: { name: string; items: CatalogCategory[] }[] = []
  for (const q of questions) {
    let g = sections.find((s) => s.name === q.section)
    if (!g) {
      g = { name: q.section, items: [] }
      sections.push(g)
    }
    g.items.push(q)
  }
  const sectionNames = sections.map((s) => s.name)

  const resetForm = () => {
    setEditingId(null)
    setFSection('')
    setFLabel('')
    setFHelp('')
    setFQtype('text')
    setFOptions([])
    setFOptionDraft('')
    setFUpcharge('')
  }

  const openAdd = () => {
    resetForm()
    setShowForm(true)
  }

  const openEdit = (q: CatalogCategory) => {
    setEditingId(q.id)
    setFSection(q.section)
    setFLabel(q.label)
    setFHelp(q.help ?? '')
    setFQtype((q.qtype as QType) ?? 'text')
    setFOptions(Array.isArray(q.options) ? [...q.options] : [])
    setFOptionDraft('')
    setFUpcharge(q.upcharge_note ?? '')
    setShowForm(true)
  }

  const addOption = () => {
    const v = fOptionDraft.trim()
    if (!v) return
    setFOptions((prev) => [...prev, v])
    setFOptionDraft('')
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!fSection.trim() || !fLabel.trim()) {
      setError('Section and label are required.')
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      section: fSection.trim(),
      label: fLabel.trim(),
      help: fHelp.trim() || null,
      qtype: fQtype,
      options: fQtype === 'radio' ? fOptions : null,
      upcharge_note: fUpcharge.trim() || null,
    }

    let opErr: string | null = null
    if (editingId) {
      const { error: e2 } = await supabase
        .from('catalog_categories')
        .update(payload)
        .eq('id', editingId)
      opErr = e2?.message ?? null
    } else {
      // Next sort_order within this section.
      const inSection = questions.filter((q) => q.section === fSection.trim())
      const maxSeq = inSection.reduce(
        (m, q) => Math.max(m, q.sort_order ?? 0),
        0,
      )
      const { error: e2 } = await supabase.from('catalog_categories').insert({
        selection_template_id: listId,
        ...payload,
        sort_order: maxSeq + 1,
      })
      opErr = e2?.message ?? null
    }
    setSaving(false)
    if (opErr) {
      setError(opErr)
      return
    }
    setShowForm(false)
    resetForm()
    await load()
  }

  const onDelete = async (q: CatalogCategory) => {
    if (!window.confirm(`Delete the question "${q.label}"?`)) return
    setError(null)
    const { error: e } = await supabase
      .from('catalog_categories')
      .delete()
      .eq('id', q.id)
    if (e) {
      setError(e.message)
      return
    }
    await load()
  }

  // Reorder within a section: swap sort_order via a temp (max+1) value.
  const move = async (q: CatalogCategory, dir: 'up' | 'down') => {
    const arr = questions
      .filter((x) => x.section === q.section)
      .sort((a, b) => a.sort_order - b.sort_order)
    const idx = arr.findIndex((x) => x.id === q.id)
    const j = dir === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || j < 0 || j >= arr.length) return
    const other = arr[j]
    const tempSeq = arr.reduce((m, x) => Math.max(m, x.sort_order ?? 0), 0) + 1
    setError(null)
    const r1 = await supabase
      .from('catalog_categories')
      .update({ sort_order: tempSeq })
      .eq('id', q.id)
    if (r1.error) return setError(r1.error.message)
    const r2 = await supabase
      .from('catalog_categories')
      .update({ sort_order: q.sort_order })
      .eq('id', other.id)
    if (r2.error) return setError(r2.error.message)
    const r3 = await supabase
      .from('catalog_categories')
      .update({ sort_order: other.sort_order })
      .eq('id', q.id)
    if (r3.error) return setError(r3.error.message)
    await load()
  }

  const iconBtn =
    'flex h-9 w-9 items-center justify-center rounded-lg border border-surfaceBorder text-muted transition hover:bg-white/5 disabled:opacity-40'
  const smallBtn =
    'min-h-[36px] rounded-lg border border-surfaceBorder px-2.5 text-[11px] font-medium transition hover:bg-white/5'

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-medium text-amber-700"
      >
        ← All selection lists
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-charcoal">{listName}</h1>
        <button
          type="button"
          onClick={openAdd}
          className="min-h-[44px] rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700"
        >
          + Add question
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      ) : questions.length === 0 ? (
        <p className="text-sm text-muted">No questions yet.</p>
      ) : (
        <div className="space-y-5">
          {sections.map((sec) => (
            <section key={sec.name}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-700">
                {sec.name}
              </h2>
              <ul className="space-y-2">
                {sec.items.map((q, i) => (
                  <li
                    key={q.id}
                    className="rounded-xl border border-surfaceBorder bg-surface p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-charcoal">{q.label}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {QTYPE_LABELS[q.qtype] ?? q.qtype}
                          {q.qtype === 'radio' && q.options
                            ? ` · ${q.options.length} options`
                            : ''}
                        </p>
                        {q.help && (
                          <p className="mt-1 text-xs text-muted">{q.help}</p>
                        )}
                        {q.upcharge_note && (
                          <p className="mt-1 text-xs italic text-muted">
                            {q.upcharge_note}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => move(q, 'up')}
                        disabled={i === 0}
                        aria-label="Move up"
                        className={iconBtn}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(q, 'down')}
                        disabled={i === sec.items.length - 1}
                        aria-label="Move down"
                        className={iconBtn}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(q)}
                        className={`${smallBtn} text-charcoal`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(q)}
                        className={`${smallBtn} text-danger hover:bg-danger/10`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Add / edit question modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setShowForm(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-charcoal">
                {editingId ? 'Edit question' : 'Add question'}
              </h2>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-white/10"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  Section <span className="text-amber">*</span>
                </label>
                <input
                  className={inputClass}
                  value={fSection}
                  onChange={(e) => setFSection(e.target.value)}
                  list="section-options"
                  placeholder="e.g. Exterior"
                />
                <datalist id="section-options">
                  {sectionNames.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  Label <span className="text-amber">*</span>
                </label>
                <input
                  className={inputClass}
                  value={fLabel}
                  onChange={(e) => setFLabel(e.target.value)}
                  placeholder="The question"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  Help (optional)
                </label>
                <input
                  className={inputClass}
                  value={fHelp}
                  onChange={(e) => setFHelp(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  Answer type
                </label>
                <select
                  className={inputClass}
                  value={fQtype}
                  onChange={(e) => setFQtype(e.target.value as QType)}
                >
                  <option value="text">Text</option>
                  <option value="radio">Choice (radio)</option>
                  <option value="yesno">Yes / No</option>
                </select>
              </div>

              {fQtype === 'radio' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-charcoal">
                    Options
                  </label>
                  <div className="space-y-2">
                    {fOptions.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate rounded-lg bg-field px-3 py-2 text-sm text-ink">
                          {opt}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setFOptions((prev) => prev.filter((_, j) => j !== i))
                          }
                          className="text-muted hover:text-danger"
                          aria-label="Remove option"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <input
                        className={inputClass}
                        value={fOptionDraft}
                        onChange={(e) => setFOptionDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addOption()
                          }
                        }}
                        placeholder="Add an option"
                      />
                      <button
                        type="button"
                        onClick={addOption}
                        className="min-h-[44px] shrink-0 rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-charcoal hover:bg-white/5"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-charcoal">
                  Upcharge note (optional)
                </label>
                <input
                  className={inputClass}
                  value={fUpcharge}
                  onChange={(e) => setFUpcharge(e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="min-h-[44px] flex-1 rounded-lg border border-surfaceBorder px-4 font-medium text-charcoal transition hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] flex-1 rounded-lg bg-amber px-4 font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
