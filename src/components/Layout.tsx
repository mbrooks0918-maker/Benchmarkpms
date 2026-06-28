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
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link to="/" aria-label="Dashboard" className="shrink-0">
            <img src={wordmark} alt="BenchMark" className="h-7 w-auto" />
          </Link>
          {/* Right cluster can shrink; the links scroll, Sign out stays pinned. */}
          <div className="flex min-w-0 items-center gap-3">
            <nav className="flex min-w-0 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Link
                to="/team"
                className="min-h-[44px] inline-flex shrink-0 items-center whitespace-nowrap rounded-lg px-2 text-sm font-medium text-charcoal transition hover:bg-white/5"
              >
                Team
              </Link>
              <Link
                to="/templates"
                className="min-h-[44px] inline-flex shrink-0 items-center whitespace-nowrap rounded-lg px-2 text-sm font-medium text-charcoal transition hover:bg-white/5"
              >
                Templates
              </Link>
              <Link
                to="/selections"
                className="min-h-[44px] inline-flex shrink-0 items-center whitespace-nowrap rounded-lg px-2 text-sm font-medium text-charcoal transition hover:bg-white/5"
              >
                Selections
              </Link>
              <Link
                to="/handbook"
                className="min-h-[44px] inline-flex shrink-0 items-center whitespace-nowrap rounded-lg px-2 text-sm font-medium text-charcoal transition hover:bg-white/5"
              >
                Handbook
              </Link>
            </nav>
            <span className="hidden max-w-[10rem] shrink-0 truncate text-sm text-muted sm:inline">
              {displayName}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="min-h-[44px] shrink-0 rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-charcoal transition hover:bg-white/5"
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
