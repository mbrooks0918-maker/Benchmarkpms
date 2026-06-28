import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import wordmark from '../assets/benchmark_logo_darkmode.png'

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, session, signOut } = useAuth()
  const displayName =
    profile?.full_name || session?.user?.email || 'Signed in'

  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-10 border-b border-surfaceBorder bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" aria-label="Dashboard">
            <img src={wordmark} alt="BenchMark" className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/team"
              className="min-h-[36px] inline-flex items-center rounded-lg px-2 text-sm font-medium text-charcoal transition hover:bg-white/5"
            >
              Team
            </Link>
            <Link
              to="/templates"
              className="min-h-[36px] inline-flex items-center rounded-lg px-2 text-sm font-medium text-charcoal transition hover:bg-white/5"
            >
              Templates
            </Link>
            <span className="hidden max-w-[10rem] truncate text-sm text-muted sm:inline">
              {displayName}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="min-h-[36px] rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-charcoal transition hover:bg-white/5"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  )
}
