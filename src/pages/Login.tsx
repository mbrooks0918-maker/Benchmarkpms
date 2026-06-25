import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import wordmark from '../assets/benchmark_logo_darkmode.png'

export default function Login() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Forgot-password flow.
  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSending, setResetSending] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  if (!loading && session) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) {
      setError('Incorrect email or password. Please try again.')
      setSubmitting(false)
    }
    // On success, onAuthStateChange handles redirect via the guard above.
  }

  const handleReset = async (e: FormEvent) => {
    e.preventDefault()
    setResetSending(true)
    // Always show the same message — don't reveal whether the email exists.
    await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setResetSending(false)
    setResetSent(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img
            src={wordmark}
            alt="BenchMark"
            className="mb-3 w-56 max-w-[80%]"
          />
          <p className="mt-1 text-sm text-muted">
            Construction project management
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl bg-surface p-6 shadow-sm"
        >
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-charcoal"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-charcoal"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
              placeholder="••••••••"
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
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          {!showReset && (
            <button
              type="button"
              onClick={() => {
                setShowReset(true)
                setResetEmail(email)
              }}
              className="min-h-[36px] w-full text-center text-sm font-medium text-amber-700"
            >
              Forgot password?
            </button>
          )}
        </form>

        {/* Forgot-password: email entry */}
        {showReset && (
          <div className="mt-4 rounded-2xl bg-surface p-6 shadow-sm">
            {resetSent ? (
              <p className="text-sm text-muted">
                If an account exists for that email, a reset link has been sent.
              </p>
            ) : (
              <form onSubmit={handleReset} className="space-y-3">
                <label
                  htmlFor="reset-email"
                  className="block text-sm font-medium text-charcoal"
                >
                  Reset your password
                </label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
                  placeholder="you@example.com"
                />
                <button
                  type="submit"
                  disabled={resetSending}
                  className="min-h-[44px] w-full rounded-lg bg-amber px-4 font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
                >
                  {resetSending ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            )}
          </div>
        )}

        <p className="mt-4 text-center text-sm text-muted">
          Need an account?{' '}
          <Link to="/signup" className="font-medium text-amber-700">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
