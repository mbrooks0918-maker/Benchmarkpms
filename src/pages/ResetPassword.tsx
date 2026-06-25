import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import wordmark from '../assets/benchmark_logo_darkmode.png'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setError(null)
    setSubmitting(true)
    const { error: updErr } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    setDone(true)
    setTimeout(() => navigate('/login', { replace: true }), 2000)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={wordmark} alt="BenchMark" className="mb-3 w-56 max-w-[80%]" />
          <p className="mt-1 text-sm text-muted">
            Construction project management
          </p>
        </div>

        {done ? (
          <div className="rounded-2xl bg-surface p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-charcoal">
              Password updated — you can now log in
            </h1>
            <p className="mt-2 text-sm text-muted">Redirecting to sign in…</p>
            <Link
              to="/login"
              className="mt-4 inline-block text-sm font-medium text-amber-700"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mb-4 text-center text-lg font-semibold text-charcoal">
              Set a new password
            </h1>
            <form
              onSubmit={handleSubmit}
              className="space-y-4 rounded-2xl bg-surface p-6 shadow-sm"
            >
              <div>
                <label
                  htmlFor="new-password"
                  className="mb-1 block text-sm font-medium text-charcoal"
                >
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
                  placeholder="At least 8 characters"
                />
              </div>

              <div>
                <label
                  htmlFor="confirm-password"
                  className="mb-1 block text-sm font-medium text-charcoal"
                >
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
                  placeholder="Re-enter password"
                />
              </div>

              {error && (
                <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] w-full rounded-lg bg-amber px-4 font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
              >
                {submitting ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
