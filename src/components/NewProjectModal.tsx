import { useState, type FormEvent } from 'react'
import { createProject } from '../lib/createProject'
import type { FoundationType, ProjectType } from '../lib/types'

interface Props {
  type: ProjectType
  onClose: () => void
  onCreated: () => void
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
      await createProject({
        type,
        name: name.trim(),
        foundation: type === 'new_build' ? foundation : null,
        client_name: clientName.trim() || null,
        address,
        total_amount: totalAmount ? Number(totalAmount) : null,
        start_date: startDate || null,
        target_completion_date: targetDate || null,
      })
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
