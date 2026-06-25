import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

/** Lets any logged-in user set a new password for their own account. */
export default function ChangePassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaved(false)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    const { error: updErr } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    setSaved(true)
    setPassword('')
    setConfirm('')
  }

  const inputClass =
    'min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber'

  return (
    <section className="rounded-2xl bg-surface p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-charcoal">Change password</h2>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <div>
          <label
            htmlFor="cp-new"
            className="mb-1 block text-sm font-medium text-charcoal"
          >
            New password
          </label>
          <input
            id="cp-new"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <label
            htmlFor="cp-confirm"
            className="mb-1 block text-sm font-medium text-charcoal"
          >
            Confirm new password
          </label>
          <input
            id="cp-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
            placeholder="Re-enter password"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-lg bg-success/15 px-3 py-2 text-sm text-success">
            Password updated
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
        >
          {saving ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </section>
  )
}
