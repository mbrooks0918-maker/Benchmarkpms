import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Signed (or public) URL to the PDF. Fetched ONCE; all pages rendered. */
  url: string
}

/**
 * Renders every page of a PDF to canvas in a scrollable column, using pdf.js.
 * This works where a native <iframe> PDF viewer fails — notably iOS Safari,
 * which otherwise shows only page 1 with no scroll. pdf.js is dynamically
 * imported so it never lands in the main bundle.
 */
export default function PdfViewer({ url }: Props) {
  const pagesRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const pdfjs = await import('pdfjs-dist')
        // Bundle the worker as an asset URL (Vite) and wire it up.
        const workerUrl = (
          await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        ).default
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

        const pdf = await pdfjs.getDocument({ url }).promise
        if (cancelled) return

        const container = pagesRef.current
        if (!container) return
        container.innerHTML = ''

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        // Render crisply at the container's width (capped for very wide screens).
        const cssWidth = Math.min(container.clientWidth || 800, 1100)

        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) return
          const page = await pdf.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({
            scale: (cssWidth / base.width) * dpr,
          })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          canvas.className = 'mx-auto mb-3 block rounded bg-white shadow-lg'
          container.appendChild(canvas)
          await page.render({ canvas, viewport }).promise
          if (n === 1 && !cancelled) setLoading(false) // reveal after page 1
        }
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
    }
  }, [url])

  return (
    <div className="relative h-full w-full overflow-y-auto rounded-lg bg-[#1b1b1b] p-2 sm:p-4">
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
