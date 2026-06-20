import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import wordmark from '../assets/benchmark_logo_darkmode.png'

export default function SignUp() {
  const { session, loading } = useAuth()
  const [companyName, setCompanyName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Set when email confirmation is ON (signUp returns a user but no session).
  const [confirmEmail, setConfirmEmail] = useState(false)

  if (!loading && session) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    // The DB trigger (handle_new_user) creates the profile, company, owner
    // membership, and seeds templates from this metadata — the client never
    // writes those rows itself.
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { company_name: companyName.trim(), full_name: fullName.trim() },
      },
    })

    if (signUpErr) {
      setError(signUpErr.message)
      setSubmitting(false)
      return
    }

    // Email confirmation ON: user created, but no session yet.
    if (!data.session) {
      setConfirmEmail(true)
      setSubmitting(false)
      return
    }
    // Email confirmation OFF: onAuthStateChange signs them in and the
    // <Navigate> guard above redirects to the dashboard. Keep the spinner.
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

        {confirmEmail ? (
          <div className="space-y-4 rounded-2xl bg-surface p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-charcoal">
              Check your email
            </h1>
            <p className="text-sm text-muted">
              Check your email to confirm your account, then sign in.
            </p>
            <Link
              to="/login"
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-amber px-4 font-medium text-white transition hover:bg-amber-700"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mb-4 text-center text-lg font-semibold text-charcoal">
              Create your account
            </h1>
            <form
              onSubmit={handleSubmit}
              className="space-y-4 rounded-2xl bg-surface p-6 shadow-sm"
            >
              <div>
                <label
                  htmlFor="company"
                  className="mb-1 block text-sm font-medium text-charcoal"
                >
                  Company name
                </label>
                <input
                  id="company"
                  type="text"
                  autoComplete="organization"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
                  placeholder="Acme Builders"
                />
              </div>

              <div>
                <label
                  htmlFor="name"
                  className="mb-1 block text-sm font-medium text-charcoal"
                >
                  Your name
                </label>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
                  placeholder="Jane Smith"
                />
              </div>

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
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
                  placeholder="At least 6 characters"
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
                {submitting ? 'Setting up your account…' : 'Create account'}
              </button>
            </form>

            <p className="mt-4 text-center text-sm text-muted">
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-amber-700">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
