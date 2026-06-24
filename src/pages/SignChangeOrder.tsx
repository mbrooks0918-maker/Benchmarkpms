import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'
import wordmark from '../assets/benchmark_logo_darkmode.png'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

interface SigningInfo {
  co_number: string | null
  description: string | null
  amount: number | null
  project_name: string | null
  project_address: string | null
  already_signed: boolean
  signed_name: string | null
  signed_at: string | null
}

/** Finger/mouse signature pad. Exposes the drawing as a PNG data URL. */
function SignaturePad({
  onChange,
}: {
  onChange: (dataUrl: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const dirty = useRef(false)

  // Size the canvas to its box, accounting for device pixel ratio.
  const setup = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#E8EDF2'
    }
  }, [])

  useEffect(() => {
    setup()
    window.addEventListener('resize', setup)
    return () => window.removeEventListener('resize', setup)
  }, [setup])

  const pointFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = pointFromEvent(e)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !last.current) return
    const p = pointFromEvent(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (!dirty.current) {
      dirty.current = true
      onChange(canvasRef.current!.toDataURL('image/png'))
    }
  }

  const onPointerUp = () => {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    if (dirty.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL('image/png'))
    }
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    dirty.current = false
    onChange(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        // touch-action:none stops the page from scrolling while signing.
        className="h-44 w-full touch-none rounded-lg border border-surfaceBorder bg-field"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          onClick={clear}
          className="min-h-[36px] rounded-lg px-3 text-sm font-medium text-muted hover:text-ink"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

// Stable page chrome. Defined at module scope so its identity never changes
// across renders — otherwise the whole subtree (name input + signature canvas)
// would remount on every keystroke/draw.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-app">
      <header className="border-b border-surfaceBorder bg-surface">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4">
          <img src={wordmark} alt="BenchMark" className="h-7 w-auto" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  )
}

export default function SignChangeOrder() {
  const { token } = useParams<{ token: string }>()

  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<SigningInfo | null>(null)
  const [invalid, setInvalid] = useState(false)

  const [typedName, setTypedName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let active = true
    if (!token) {
      setInvalid(true)
      setLoading(false)
      return
    }
    ;(async () => {
      const { data, error: rpcErr } = await supabase.rpc(
        'get_change_order_for_signing',
        { p_token: token },
      )
      if (!active) return
      if (rpcErr || !data) {
        setInvalid(true)
      } else {
        setInfo(data as SigningInfo)
      }
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [token])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!token) return
    if (!typedName.trim()) {
      setError('Please type your full name.')
      return
    }
    if (!signature) {
      setError('Please draw your signature.')
      return
    }
    if (!agreed) {
      setError('Please check the box to agree.')
      return
    }
    setSubmitting(true)
    setError(null)

    // Best-effort IP capture; never block signing on it.
    let ip = ''
    try {
      const res = await fetch('https://api.ipify.org?format=json')
      const json = await res.json()
      ip = json?.ip ?? ''
    } catch {
      ip = ''
    }

    const { error: signErr } = await supabase.rpc('sign_change_order', {
      p_token: token,
      p_name: typedName.trim(),
      p_signature: signature,
      p_ip: ip,
    })
    setSubmitting(false)
    if (signErr) {
      setError(signErr.message)
      return
    }
    setDone(true)
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      </Shell>
    )
  }

  if (invalid || !info) {
    return (
      <Shell>
        <div className="rounded-2xl bg-surface p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-charcoal">Change order</h1>
          <p className="mt-2 text-sm text-muted">
            This change order link is invalid or has been voided.
          </p>
        </div>
      </Shell>
    )
  }

  if (done || info.already_signed) {
    const name = done ? typedName.trim() : info.signed_name
    return (
      <Shell>
        <div className="rounded-2xl bg-surface p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/20 text-success">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          {done ? (
            <>
              <h1 className="text-lg font-semibold text-charcoal">
                Thank you — your signature has been recorded.
              </h1>
            </>
          ) : (
            <h1 className="text-lg font-semibold text-charcoal">
              This change order was signed
              {name ? ` by ${name}` : ''}
              {info.signed_at ? ` on ${formatDate(info.signed_at)}` : ''}.
            </h1>
          )}
        </div>
      </Shell>
    )
  }

  const inputClass =
    'min-h-[44px] w-full rounded-lg border border-surfaceBorder bg-field text-ink placeholder:text-muted px-3 text-base outline-none focus:border-amber focus:ring-1 focus:ring-amber'

  return (
    <Shell>
      {/* Context */}
      <div className="rounded-2xl bg-surface p-5 shadow-sm">
        {info.project_name && (
          <h1 className="text-xl font-bold text-charcoal">
            {info.project_name}
          </h1>
        )}
        {info.project_address && (
          <p className="text-sm text-muted">{info.project_address}</p>
        )}

        <div className="mt-4 rounded-xl bg-field p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Change order{info.co_number ? ` ${info.co_number}` : ''}
            </span>
            {info.amount != null && (
              <span
                className={`text-xl font-bold ${
                  info.amount < 0 ? 'text-danger' : 'text-charcoal'
                }`}
              >
                {usd.format(info.amount)}
              </span>
            )}
          </div>
          {info.description && (
            <p className="mt-2 text-sm text-charcoal">{info.description}</p>
          )}
        </div>

        <p className="mt-4 text-sm text-muted">
          By signing below, I approve this change order and the associated cost.
        </p>
      </div>

      {/* Sign form */}
      <form
        onSubmit={handleSubmit}
        className="mt-4 space-y-4 rounded-2xl bg-surface p-5 shadow-sm"
      >
        <div>
          <label
            htmlFor="signer-name"
            className="mb-1 block text-sm font-medium text-charcoal"
          >
            Full name
          </label>
          <input
            id="signer-name"
            type="text"
            autoComplete="name"
            required
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            className={inputClass}
            placeholder="Type your full name"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-charcoal">
            Signature
          </label>
          <SignaturePad onChange={setSignature} />
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-surfaceBorder accent-amber"
          />
          <span className="text-sm text-ink">I agree to this change order</span>
        </label>

        {error && (
          <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-[48px] w-full rounded-lg bg-amber px-4 font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Sign change order'}
        </button>
      </form>
    </Shell>
  )
}
