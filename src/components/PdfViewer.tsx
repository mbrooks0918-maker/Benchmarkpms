import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Signed (or public) URL to the PDF. Reused across opens so the browser can
   *  cache it. */
  url: string
}

/**
 * Renders a PDF page-by-page, LAZILY. Uses pdf.js with `disableAutoFetch` so it
 * only requests (ranged) the bytes for pages actually viewed — glancing at page
 * 1 of a large plan transfers ~page 1, not the whole file. Pages render when
 * scrolled into view (IntersectionObserver); page 1 renders immediately so the
 * viewer isn't blank. pdf.js is dynamically imported (kept out of the main
 * bundle). This also works on iOS Safari, where a native <iframe> shows only
 * page 1.
 */
export default function PdfViewer({ url }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let observer: IntersectionObserver | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdf: any = null

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const pdfjs = await import('pdfjs-dist')
        const workerUrl = (
          await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        ).default
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

        // Ranged, on-demand fetching: only pages we render pull their bytes.
        pdf = await pdfjs.getDocument({
          url,
          disableAutoFetch: true,
          disableStream: false,
        }).promise
        if (cancelled) return

        const container = pagesRef.current
        if (!container) return
        container.innerHTML = ''

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const cssWidth = Math.min(container.clientWidth || 800, 1100)

        // Use page 1's aspect to size not-yet-rendered placeholders, so they
        // don't all sit in view at once (which would fetch every page).
        const first = await pdf.getPage(1)
        if (cancelled) return
        const firstBase = first.getViewport({ scale: 1 })
        const estHeight = Math.round(cssWidth * (firstBase.height / firstBase.width))

        const rendered = new Set<number>()
        const renderPage = async (
          n: number,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          page?: any,
        ) => {
          if (cancelled || rendered.has(n)) return
          rendered.add(n)
          const holder = container.querySelector<HTMLDivElement>(
            `[data-page="${n}"]`,
          )
          if (!holder) return
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pg: any = page ?? (await pdf.getPage(n))
          if (cancelled) return
          const viewport = pg.getViewport({
            scale: (cssWidth / pg.getViewport({ scale: 1 }).width) * dpr,
          })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          canvas.className = 'block rounded'
          holder.style.minHeight = ''
          holder.innerHTML = ''
          holder.appendChild(canvas)
          await pg.render({ canvas, viewport }).promise
        }

        // Build a placeholder per page and observe it.
        observer = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                const n = Number(
                  (e.target as HTMLElement).dataset.page ?? '0',
                )
                if (n) {
                  renderPage(n)
                  observer?.unobserve(e.target)
                }
              }
            }
          },
          { root: scrollRef.current, rootMargin: '400px 0px' },
        )

        for (let n = 1; n <= pdf.numPages; n++) {
          const holder = document.createElement('div')
          holder.dataset.page = String(n)
          holder.style.minHeight = `${estHeight}px`
          holder.className =
            'mx-auto mb-3 w-full bg-white shadow-lg rounded overflow-hidden'
          container.appendChild(holder)
          if (n > 1) observer.observe(holder)
        }

        // Render page 1 up front (reusing the page object we already fetched).
        await renderPage(1, first)
        if (!cancelled) setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not render this PDF.')
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      observer?.disconnect()
      try {
        pdf?.destroy?.()
      } catch {
        /* ignore */
      }
    }
  }, [url])

  return (
    <div
      ref={scrollRef}
      className="relative h-full w-full overflow-y-auto rounded-lg bg-[#1b1b1b] p-2 sm:p-4"
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber border-t-transparent" />
        </div>
      )}
      {error && (
        <div className="flex h-full items-center justify-center px-4 text-center">
          <p className="text-sm text-white/80">
            Couldn’t display this PDF in-app. Use Download to open it.
          </p>
        </div>
      )}
      <div ref={pagesRef} className="mx-auto w-full max-w-4xl" />
    </div>
  )
}
