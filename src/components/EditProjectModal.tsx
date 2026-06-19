import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Project, ProjectStatus } from '../lib/types'

interface Props {
  project: Project
  onClose: () => void
  onSaved: () => void
}

/**
 * Best-effort split of the stored single `address` column
 * ("Street, City, State ZIP") back into its input parts. The trailing comma
 * segment is "State ZIP"; we peel a trailing ZIP (5 digits, optional +4) off it
 * so State and ZIP land in their own boxes. Older "Street, City, State" values
 * (no ZIP) still parse cleanly.
 */
function splitAddress(address: string | null): {
  street: string
  city: string
  state: string
  zip: string
} {
  if (!address) return { street: '', city: '', state: '', zip: '' }
  const parts = address.split(',').map((p) => p.trim())
  const street = parts[0] ?? ''
  let city = ''
  let tail = ''
  if (parts.length > 1) {
    tail = parts[parts.length - 1]
    city = parts.slice(1, parts.length - 1).join(', ')
  }
  // Split the "State ZIP" tail; only treat the last token as a ZIP if it looks
  // like one, so multi-word states (e.g. "New York") aren't mangled.
  let state = tail
  let zip = ''
  const m = tail.match(/^(.*?)\s+(\d{5}(?:-\d{4})?)$/)
  if (m) {
    state = m[1].trim()
    zip = m[2]
  }
  return { street, city, state, zip }
}

export default function EditProjectModal({ project, onClose, onSaved }: Props) {
  const initialAddress = splitAddress(project.address)

  const [name, setName] = useState(project.name)
  const [clientName, setClientName] = useState(project.client_name ?? '')
  const [street, setStreet] = useState(initialAddress.street)
  const [city, setCity] = useState(initialAddress.city)
  const [state, setState] = useState(initialAddress.state)
  const [zip, setZip] = useState(initialAddress.zip)
  const [totalAmount, setTotalAmount] = useState(
    project.total_amount != null ? String(project.total_amount) : '',
  )
  const [startDate, setStartDate] = useState(project.start_date ?? '')
  const [targetDate, setTargetDate] = useState(
    project.target_completion_date ?? '',
  )
  // Only Active / On hold here — completion is handled separately.
  const [status, setStatus] = useState<ProjectStatus>(
    project.status === 'on_hold' ? 'on_hold' : 'active',
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setError(null)
    setSubmitting(true)

    // Recombine into "Street, City, State ZIP" — ZIP follows State with a
    // SPACE, empty parts dropped (no stray commas) — same rule as the create form.
    const stateZip = [state.trim(), zip.trim()].filter(Boolean).join(' ')
    const address =
      [street.trim(), city.trim(), stateZip].filter(Boolean).join(', ') || null

    const { error: updErr } = await supabase
      .from('projects')
      .update({
        name: name.trim(),
        client_name: clientName.trim() || null,
        address,
        total_amount: totalAmount ? Number(totalAmount) : null,
        start_date: startDate || null,
        target_completion_date: targetDate || null,
        status,
      })
      .eq('id', project.id)

    setSubmitting(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    onSaved()
    onClose()
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
          <h2 className="text-lg font-semibold text-charcoal">Edit project</h2>
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
              Contract total (USD)
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

          <div>
            <label className="mb-1 block text-sm font-medium text-charcoal">
              Status
            </label>
            <select
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            >
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
            </select>
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
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
