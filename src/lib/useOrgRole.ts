import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from '../context/AuthContext'

/**
 * The current user's org role ('owner' | 'pm') from org_members. `isOwner` is
 * false while loading, so money/owner-only UI stays hidden until confirmed —
 * never flashing financials to a PM. Owners just see a brief delay.
 */
export function useOrgRole() {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (!userId) {
      setRole(null)
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('org_members')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setRole((data?.role as string | undefined) ?? null)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [userId])

  return { role, isOwner: role === 'owner', loading }
}
