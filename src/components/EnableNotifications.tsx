import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  disablePush,
  enablePush,
  getPushStatus,
  type PushStatus,
} from '../lib/push'

/**
 * Header control the user taps once to let this device receive push alerts.
 * Hidden entirely on devices that can't do web push (e.g. iOS Safari that
 * hasn't been installed to the home screen).
 */
export default function EnableNotifications() {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getPushStatus().then((s) => {
      if (active) setStatus(s)
    })
    return () => {
      active = false
    }
  }, [userId])

  // Nothing to show until we know, on unsupported devices, or if signed out.
  if (!userId || status === null || status === 'unsupported') return null

  const onClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      setStatus(status === 'on' ? await disablePush() : await enablePush(userId))
    } catch {
      // Re-read actual state on failure.
      setStatus(await getPushStatus())
    } finally {
      setBusy(false)
    }
  }

  if (status === 'denied') {
    return (
      <span
        title="Notifications are blocked in your device settings for this app."
        className="hidden shrink-0 items-center gap-1 text-xs text-muted sm:inline-flex"
      >
        Alerts blocked
      </span>
    )
  }

  const on = status === 'on'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={on ? 'Disable alerts on this device' : 'Enable alerts on this device'}
      title={on ? 'Alerts on for this device' : 'Enable alerts on this device'}
      className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition disabled:opacity-60 ${
        on
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-surfaceBorder text-charcoal hover:bg-white/5'
      }`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={on ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <span className="hidden sm:inline">
        {busy ? '…' : on ? 'Alerts on' : 'Enable alerts'}
      </span>
    </button>
  )
}
