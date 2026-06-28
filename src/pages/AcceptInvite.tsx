import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import wordmark from '../assets/benchmark_logo_darkmode.png'

const PENDING_KEY = 'pending_invite_token'

interface InviteInfo {
  company_name: string | null
  email: string | null
}

export default function AcceptInvite() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [loading, setLoading] = useState(true)
  const [invite, setInvite] = useState<InviteInfo | null>(null)

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState(false)
  const [done, setDone] = useState(false)

  // Look up the invite by token.
  useEffect(() => {
    let active = true
    if (!token) {
      setLoading(false)
      return
    }
    ;(async () => {
      const { data, error: rpcErr } = await supabase.rpc('get_invite', {
        p_token: token,
      })
      if (!active) return
      if (rpcErr || !data) {
        setInvite(null)
      } else {
        setInvite(data as InviteInfo)
      }
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [token])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!token || !invite?.email) return
    setError(null)
    setSubmitting(true)

    // Stash the token so a confirm-email flow can complete the join on next
    // login (the Dashboard finishes it). Cleared on immediate success below.
    localStorage.setItem(PENDING_KEY, token)

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: invite.email,
      password,
      options: { data: { full_name: fullName.trim(), invite_token: token } },
    })

    if (signUpErr) {
      localStorage.removeItem(PENDING_KEY)
      setError(signUpErr.message)
      setSubmitting(false)
      return
    }

    // Email confirmation OFF → we have a session; join the org now.
    if (data.session) {
      const { error: acceptErr } = await supabase.rpc('accept_invite', {
        p_token: token,
      })
      if (acceptErr) {
        // Keep the token (don't strand): the Dashboard retries the idempotent
        // accept on load. Route in either way so that retry can run.
        console.error(
          'accept_invite failed at signup; will retry after redirect:',
          acceptErr.message,
        )
      } else {
        localStorage.removeItem(PENDING_KEY)
      }
      // Full reload so the app picks up the new session + membership.
      setDone(true)
      window.location.assign('/')
      return
    }

    // Email confirmation ON → finish after they confirm + sign in.
    setConfirmEmail(true)
    setSubmitting(false)
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

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-amber border-t-transparent" />
          </div>
        ) : !token || !invite ? (
          <div className="rounded-2xl bg-surface p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-charcoal">Invite</h1>
            <p className="mt-2 text-sm text-muted">
              This invite is invalid or has already been used.
            </p>
            <Link
              to="/login"
              className="mt-4 inline-block text-sm font-medium text-amber-700"
            >
              Go to sign in
            </Link>
          </div>
        ) : confirmEmail ? (
          <div className="rounded-2xl bg-surface p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-charcoal">
              Check your email
            </h1>
            <p className="mt-2 text-sm text-muted">
              Check your email to confirm, then sign in to join the team.
            </p>
            <Link
              to="/login"
              className="mt-4 inline-block text-sm font-medium text-amber-700"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-4 text-center">
              <h1 className="text-lg font-semibold text-charcoal">
                You've been invited to join{' '}
                {invite.company_name || 'the team'} as a Project Manager
              </h1>
              {invite.email && (
                <p className="mt-1 text-sm text-muted">{invite.email}</p>
              )}
            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-4 rounded-2xl bg-surface p-6 shadow-sm"
            >
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
                  value={invite.email ?? ''}
                  readOnly
                  className="min-h-[44px] w-full cursor-not-allowed rounded-lg border border-surfaceBorder bg-field/60 text-muted px-3 text-base outline-none"
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
                <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
                  <p>{error}</p>
                  {/already registered/i.test(error) && (
                    <p className="mt-1">
                      If you already have an account, sign in first, then re-open
                      this invite link.
                    </p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || done}
                className="min-h-[44px] w-full rounded-lg bg-amber px-4 font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
              >
                {submitting || done ? 'Joining…' : 'Accept invite'}
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
