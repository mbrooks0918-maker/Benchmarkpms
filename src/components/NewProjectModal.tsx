import { useEffect, useState, type FormEvent } from 'react'
import { createProject } from '../lib/createProject'
import { supabase } from '../lib/supabase'
import type { FoundationType, ProjectType } from '../lib/types'

interface Props {
  type: ProjectType
  onClose: () => void
  onCreated: () => void
}

interface OrgPm {
  user_id: string
  full_name: string | null
}

const LABELS: Record<ProjectType, string> = {
  new_build: 'New Build',
  renovation: 'Renovation',
}

export default function NewProjectModal({ type, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [foundation, setFoundation] = useState<FoundationType | null>(null)
  const [clientName, setClientName] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [startDate, setStartDate] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Project managers in this org, for the assignment picker.
  const [pms, setPms] = useState<OrgPm[]>([])
  const [selectedPms, setSelectedPms] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase.rpc('org_members_list')
      if (!active) return
      const rows = (
        (data ?? []) as { user_id: string; full_name: string | null; role: string }[]
      ).filter((r) => r.role === 'pm')
      setPms(rows.map((r) => ({ user_id: r.user_id, full_name: r.full_name })))
      // Exactly one PM → pre-select. Zero or several → leave the owner to pick.
      if (rows.length === 1) setSelectedPms(new Set([rows[0].user_id]))
    })()
    return () => {
      active = false
    }
  }, [])

  const togglePm = (id: string) =>
    setSelectedPms((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (type === 'new_build' && !foundation) {
      setError('Please choose a foundation type (Slab or Crawlspace).')
      return
    }
    setError(null)
    setSubmitting(true)

    // Combine the location inputs into the single `address` column as
    // "Street, City, State ZIP". ZIP follows State with a SPACE (not a comma);
    // empty parts are dropped so there are no stray commas.
    const stateZip = [state.trim(), zip.trim()].filter(Boolean).join(' ')
    const address =
      [street.trim(), city.trim(), stateZip].filter(Boolean).join(', ') || null

    try {
      const newId = await createProject({
        type,
        name: name.trim(),
        foundation: type === 'new_build' ? foundation : null,
        client_name: clientName.trim() || null,
        address,
        total_amount: totalAmount ? Number(totalAmount) : null,
        start_date: startDate || null,
        target_completion_date: targetDate || null,
      })

      // Assign the chosen PM(s) to the new project. Done after the project
      // exists; a failure here shouldn't undo the created job.
      if (newId && selectedPms.size > 0) {
        const rows = [...selectedPms].map((user_id) => ({
          project_id: newId,
          user_id,
        }))
        const { error: assignErr } = await supabase
          .from('project_assignments')
          .insert(rows)
        if (assignErr) {
          console.error('Failed to assign PMs:', assignErr.message)
        }
      }

      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-charcoal">
            New {LABELS[type]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-white/10"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-charcoal">
              Name <span className="text-amber">*</span>
            </label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          {type === 'new_build' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-charcoal">
                Foundation <span className="text-amber">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    { value: 'slab', label: 'Slab' },
                    { value: 'crawlspace', label: 'Crawlspace' },
                  ] as { value: FoundationType; label: string }[]
                ).map((opt) => {
                  const selected = foundation === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setFoundation(opt.value)}
                      className={`min-h-[48px] rounded-lg border px-4 text-base font-medium transition ${
                        selected
                          ? 'border-amber bg-amber text-white'
                          : 'border-surfaceBorder text-charcoal hover:bg-white/5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-charcoal">
              Client name
            </label>
            <input
              className={inputClass}
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-charcoal">
              Street address
            </label>
            <input
              className={inputClass}
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="123 Main St"
            />
          </div>

          <div className="grid grid-cols-6 gap-3">
            <div className="col-span-3">
              <label className="mb-1 block text-sm font-medium text-charcoal">
                City
              </label>
              <input
                className={inputClass}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Albertville"
              />
            </div>
            <div className="col-span-1">
              <label className="mb-1 block text-sm font-medium text-charcoal">
                State
              </label>
              <input
                className={inputClass}
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="AL"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-charcoal">
                ZIP
              </label>
              <input
                className={inputClass}
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                inputMode="numeric"
                placeholder="35950"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-charcoal">
              Total amount (USD)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-charcoal">
                Start date
              </label>
              <input
                type="date"
                className={inputClass}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-charcoal">
                Target completion
              </label>
              <input
                type="date"
                className={inputClass}
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>

          {/* Assign PM(s) */}
          {pms.length === 0 ? (
            <p className="text-xs text-muted">
              No project managers yet — invite one on the Team page.
            </p>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-charcoal">
                Assign Project Manager(s)
              </label>
              <div className="space-y-2">
                {pms.map((pm) => {
                  const checked = selectedPms.has(pm.user_id)
                  return (
                    <label
                      key={pm.user_id}
                      className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-surfaceBorder bg-field px-3"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePm(pm.user_id)}
                        className="h-5 w-5 shrink-0 cursor-pointer rounded border-surfaceBorder accent-amber"
                      />
                      <span className="text-sm text-ink">
                        {pm.full_name?.trim() || 'PM'}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] flex-1 rounded-lg border border-surfaceBorder px-4 font-medium text-charcoal transition hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] flex-1 rounded-lg bg-amber px-4 font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
