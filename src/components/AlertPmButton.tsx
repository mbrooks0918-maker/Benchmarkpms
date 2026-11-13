import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  projectId: string
  /** Pre-filled text the owner can edit before sending. */
  defaultMessage?: string
  /** 'sm' for the compact per-phase button, 'md' for the project header. */
  size?: 'sm' | 'md'
}

type Result = { kind: 'ok'; text: string } | { kind: 'err'; text: string }

/**
 * Owner-facing "Alert PM" control. Opens a short composer, then pushes the
 * message to the PM(s) assigned to this project via the send-pm-alert edge
 * function. The author is never notified of their own alert.
 */
export default function AlertPmButton({
  projectId,
  defaultMessage = '',
  size = 'md',
}: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(defaultMessage)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const sm = size === 'sm'

  const openComposer = () => {
    setText(defaultMessage)
    setResult(null)
    setOpen(true)
  }

  const send = async () => {
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    setResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('send-pm-alert', {
        body: { projectId, message },
      })
      if (error) throw error
      const sent = (data as { sent?: number; reason?: string })?.sent ?? 0
      if (sent > 0) {
        setResult({ kind: 'ok', text: `Alert sent to PM${sent > 1 ? 's' : ''}.` })
        setOpen(false)
      } else {
        const reason =
          (data as { reason?: string })?.reason ??
          'No PM is set up to receive alerts yet.'
        setResult({ kind: 'err', text: reason })
      }
    } catch (e) {
      setResult({
        kind: 'err',
        text: e instanceof Error ? e.message : 'Could not send the alert.',
      })
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <div className={sm ? '' : 'w-full'}>
        <button
          type="button"
          onClick={openComposer}
          className={
            sm
              ? 'inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-accent/40 px-3 text-xs font-medium text-accent transition hover:bg-accent/10'
              : 'inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-accent/50 px-4 text-sm font-medium text-accent transition hover:bg-accent/10'
          }
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={sm ? 'h-3.5 w-3.5' : 'h-4 w-4'}
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          Alert PM
        </button>
        {result && (
          <p
            className={`mt-1 text-xs ${
              result.kind === 'ok' ? 'text-accent' : 'text-danger'
            }`}
          >
            {result.text}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="w-full rounded-lg border border-accent/40 bg-field p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">
        Alert PM
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        autoFocus
        placeholder="What should the PM know?"
        className="mt-1 w-full rounded-lg border border-surfaceBorder bg-surface text-ink placeholder:text-muted px-2.5 py-1.5 text-sm outline-none focus:border-amber focus:ring-1 focus:ring-amber"
      />
      {result?.kind === 'err' && (
        <p className="mt-1 text-xs text-danger">{result.text}</p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="min-h-[40px] flex-1 rounded-lg bg-accent px-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {sending ? 'Sending…' : 'Send alert'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setResult(null)
          }}
          disabled={sending}
          className="min-h-[40px] flex-1 rounded-lg border border-surfaceBorder bg-surface px-3 text-sm font-medium text-charcoal transition hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
