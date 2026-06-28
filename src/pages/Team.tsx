import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import ChangePassword from '../components/ChangePassword'

interface OrgInvite {
  id: string
  org_id: string
  email: string
  role: string
  token: string
  accepted: boolean
  created_at: string
}

interface MemberRow {
  user_id: string
  role: string
  full_name: string | null
}

function inviteUrl(token: string): string {
  return `${window.location.origin}/accept-invite?token=${token}`
}

function roleLabel(role: string): string {
  if (role === 'pm') return 'PM'
  if (role === 'owner') return 'Owner'
  return role.charAt(0).toUpperCase() + role.slice(1)
}

/** Name to show for a member — full_name, or their role label if no name. */
function memberDisplayName(m: MemberRow): string {
  // Always the person's name — never the role. (Email isn't readable client-side,
  // so a neutral placeholder is used only if a profile has no name at all.)
  return m.full_name?.trim() || 'Unknown member'
}

export default function Team() {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null

  const [orgId, setOrgId] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [creating, setCreating] = useState(false)
  const [newLink, setNewLink] = useState<string | null>(null)

  const [invites, setInvites] = useState<OrgInvite[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load the org's pending invites and members (roster is visible to PMs too).
  const loadOrgData = useCallback(async (org: string) => {
    // The roster comes from org_members_list() — a SECURITY DEFINER RPC that
    // returns user_id + full_name + role for the caller's org. A direct
    // profiles query can't read OTHER members' rows (RLS), which is why names
    // came back empty before.
    const [invRes, memRes] = await Promise.all([
      supabase
        .from('org_invites')
        .select('*')
        .eq('org_id', org)
        .eq('accepted', false)
        .order('created_at', { ascending: false }),
      supabase.rpc('org_members_list'),
    ])
    if (!invRes.error) setInvites((invRes.data ?? []) as OrgInvite[])

    const memberRows = (memRes.data ?? []) as {
      user_id: string
      full_name: string | null
      role: string
    }[]
    setMembers(
      memberRows.map((m) => ({
        user_id: m.user_id,
        role: m.role,
        full_name: m.full_name,
      })),
    )
  }, [])

  const init = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    const { data, error: memErr } = await supabase
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', userId)
      .maybeSingle()
    if (memErr) {
      setError(memErr.message)
      setLoading(false)
      return
    }
    const org = (data?.org_id as string | undefined) ?? null
    setOrgId(org)
    setIsOwner(data?.role === 'owner')
    // Everyone in the org (owners and PMs) can see the roster + pending invites.
    if (org) await loadOrgData(org)
    setLoading(false)
  }, [userId, loadOrgData])

  useEffect(() => {
    init()
  }, [init])

  const onCreateInvite = async () => {
    if (!orgId || !email.trim()) return
    setCreating(true)
    setError(null)
    setNewLink(null)
    const { data, error: insErr } = await supabase
      .from('org_invites')
      .insert({ org_id: orgId, email: email.trim(), role: 'pm' })
      .select('*')
      .single()
    setCreating(false)
    if (insErr || !data) {
      setError(insErr?.message ?? 'Could not create invite.')
      return
    }
    setNewLink(inviteUrl((data as OrgInvite).token))
    setEmail('')
    await loadOrgData(orgId)
  }

  const onCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token))
      setCopiedToken(token)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopiedToken(null), 2000)
    } catch {
      setError('Could not copy — copy the link manually.')
    }
  }

  const onDeleteInvite = async (inv: OrgInvite) => {
    if (!orgId) return
    if (!window.confirm(`Delete the invite for ${inv.email}?`)) return
    setError(null)
    const { error: delErr } = await supabase
      .from('org_invites')
      .delete()
      .eq('id', inv.id)
    if (delErr) {
      setError(delErr.message)
      return
    }
    await loadOrgData(orgId)
  }

  const onRemoveMember = async (m: MemberRow) => {
    if (!orgId) return
    // Owners are never removable from this UI.
    if (m.role === 'owner') return
    if (
      !window.confirm(
        `Remove ${memberDisplayName(m)}? This deletes their account.`,
      )
    )
      return
    setError(null)
    // RPC removes membership, unassigns their jobs, and deletes their login.
    const { error: rpcErr } = await supabase.rpc('remove_member', {
      p_user: m.user_id,
    })
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    await loadOrgData(orgId)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-amber border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Team</h1>

      {error && (
        <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Account — any logged-in user can change their own password */}
      <ChangePassword />

      {/* Invite a PM — owners only */}
      {isOwner && (
        <section className="rounded-2xl bg-surface p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-charcoal">
            Invite a Project Manager
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pm@example.com"
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber"
            />
            <button
              type="button"
              onClick={onCreateInvite}
              disabled={creating || !email.trim()}
              className="min-h-[44px] rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Create invite'}
            </button>
          </div>

          {newLink && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Invite link
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-field px-3 py-2 text-sm text-ink">
                  {newLink}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(newLink).catch(() => {})
                    setCopiedToken('new')
                    if (copyTimer.current) clearTimeout(copyTimer.current)
                    copyTimer.current = setTimeout(
                      () => setCopiedToken(null),
                      2000,
                    )
                  }}
                  className="min-h-[44px] rounded-lg bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-700"
                >
                  {copiedToken === 'new' ? 'Copied!' : 'Copy link'}
                </button>
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-muted">
            The invited person joins your company as a Project Manager — they
            don't create a new company.
          </p>
        </section>
      )}

      {/* Pending invites — visible to all; management buttons owners-only */}
      <section className="rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-charcoal">Pending invites</h2>
        {invites.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No pending invites.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-surfaceBorder bg-field p-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {inv.email}
                </span>
                {isOwner && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => onCopy(inv.token)}
                      className="min-h-[40px] rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-charcoal transition hover:bg-white/5"
                    >
                      {copiedToken === inv.token ? 'Copied!' : 'Copy link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteInvite(inv)}
                      className="min-h-[40px] rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-danger transition hover:bg-danger/10"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Team members — visible to all; Remove owners-only and never for owners */}
      <section className="rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-charcoal">Team members</h2>
        {members.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No members yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {members.map((m) => {
              const removable =
                isOwner && m.role !== 'owner' && m.user_id !== userId
              return (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-surfaceBorder bg-field p-3"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {memberDisplayName(m)}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-amber/10 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                      {roleLabel(m.role)}
                    </span>
                    {removable && (
                      <button
                        type="button"
                        onClick={() => onRemoveMember(m)}
                        className="min-h-[40px] rounded-lg border border-surfaceBorder px-3 text-sm font-medium text-danger transition hover:bg-danger/10"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
