import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AmountType, Draw } from '../lib/types'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function todayISO(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** "$X,XXX" for fixed; "Y% ($Z)" for percent (Z = that % of the contract total). */
export function formatDrawAmount(draw: Draw, total: number | null): string {
  if (draw.amount_type === 'percent') {
    const dollars = total != null ? (total * draw.amount_value) / 100 : 0
    return `${draw.amount_value}% (${usd.format(dollars)})`
  }
  return usd.format(draw.amount_value)
}

interface Props {
  draw: Draw
  total: number | null
  /** Anchor is satisfied (phase complete, or benchmark completed). */
  ready: boolean
  allowRemove?: boolean
  onChanged: () => void
  setError: (msg: string | null) => void
}

export default function DrawItem({
  draw,
  total,
  ready,
  allowRemove = false,
  onChanged,
  setError,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [amountType, setAmountType] = useState<AmountType>(draw.amount_type)
  // Show 0 as an empty field (with a "0" placeholder) so there's no leading 0
  // to delete before typing.
  const [amountValue, setAmountValue] = useState(
    draw.amount_value ? String(draw.amount_value) : '',
  )
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

  const openEditor = () => {
    setAmountType(draw.amount_type)
    setAmountValue(draw.amount_value ? String(draw.amount_value) : '')
    setEditing(true)
  }

  const onSave = async () => {
    setSaving(true)
    setError(null)
    const { error } = await supabase
      .from('draws')
      .update({
        amount_type: amountType,
        amount_value: Number(amountValue) || 0,
      })
      .eq('id', draw.id)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setEditing(false)
    onChanged()
  }

  const setReleased = async (released: boolean) => {
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from('draws')
      .update({
        released,
        released_date: released ? todayISO() : null,
      })
      .eq('id', draw.id)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    onChanged()
  }

  const onRemove = async () => {
    if (!window.confirm(`Remove draw "${draw.label}"?`)) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('draws').delete().eq('id', draw.id)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    onChanged()
  }

  return (
    <div className="rounded-lg border border-surfaceBorder bg-field p-3">
      {editing ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-charcoal">{draw.label}</p>
          <div className="flex gap-2">
            <select
              value={amountType}
              onChange={(e) => setAmountType(e.target.value as AmountType)}
              className="min-h-[40px] rounded-lg border border-surfaceBorder bg-surface text-ink px-2 text-sm outline-none focus:border-amber focus:ring-1 focus:ring-amber"
            >
              <option value="fixed">$ fixed</option>
              <option value="percent">% of contract</option>
            </select>
            <input
              type="number"
              min="0"
              step={amountType === 'percent' ? '0.1' : '1'}
              value={amountValue}
              onChange={(e) => setAmountValue(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="0"
              className="min-h-[40px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-sm outline-none focus:border-amber focus:ring-1 focus:ring-amber"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-[40px] flex-1 rounded-lg border border-surfaceBorder bg-surface px-3 text-sm font-medium text-charcoal hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="min-h-[40px] flex-1 rounded-lg bg-amber px-3 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={openEditor}
              className="min-w-0 flex-1 text-left"
              title="Tap to edit amount"
            >
              <p className="truncate text-sm font-medium text-charcoal">
                {draw.label}
              </p>
              <p className="text-sm text-muted">
                {formatDrawAmount(draw, total)}
              </p>
            </button>
            {allowRemove && (
              <button
                type="button"
                aria-label="Remove draw"
                title="Remove draw"
                onClick={onRemove}
                disabled={busy}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger/15 hover:text-danger"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            )}
          </div>

          <div className="mt-2">
            {draw.released ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-success/15 px-2 py-1 text-xs font-medium text-success">
                  ✓ Invoiced on {fmtDate(draw.released_date)}
                </span>
                <button
                  type="button"
                  onClick={() => setReleased(false)}
                  disabled={busy}
                  className="text-xs font-medium text-muted underline hover:text-ink"
                >
                  Undo
                </button>
              </div>
            ) : ready ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-success/15 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-success">
                  Ready to invoice
                </span>
                <button
                  type="button"
                  onClick={() => setReleased(true)}
                  disabled={busy}
                  className="min-h-[36px] rounded-lg bg-amber px-3 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  Mark invoiced
                </button>
              </div>
            ) : (
              <span className="text-xs text-muted">Pending</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
