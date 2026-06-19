import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('Failed to load profile:', error.message)
    return null
  }
  return data as Profile
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    // Resolve the initial session, then unblock rendering immediately — the
    // session alone is enough to render the app. The profile (display name /
    // role) is fetched in the BACKGROUND so a slow network round-trip can't
    // gate first paint behind the full-screen spinner.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (active) setLoading(false)
      if (data.session?.user) {
        fetchProfile(data.session.user.id).then((p) => {
          if (active) setProfile(p)
        })
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!active) return
        setSession(newSession)
        if (active) setLoading(false)
        if (newSession?.user) {
          fetchProfile(newSession.user.id).then((p) => {
            if (active) setProfile(p)
          })
        } else {
          setProfile(null)
        }
      },
    )

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
