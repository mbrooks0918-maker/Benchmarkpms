import type { ChangeOrder } from './types'
import { formatDate } from './format'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Date + time for the signed_at timestamp. */
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * The signature is drawn in the app's light ink color (for a dark canvas), which
 * would be invisible on a white PDF page. Recolor the (transparent-background)
 * strokes to dark while preserving their shape, using `source-in` compositing.
 * Returns the original data URL if anything goes wrong.
 */
async function recolorSignature(
  dataUrl: string,
  color = '#111111',
): Promise<string> {
  try {
    const img = await loadImage(dataUrl)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width || 600
    canvas.height = img.naturalHeight || img.height || 200
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return dataUrl
  }
}

/**
 * Build and download a signed change-order PDF entirely in the browser.
 * Gracefully omits the signature image if it's missing or can't be processed.
 */
export async function downloadSignedCoPdf(
  co: ChangeOrder,
  projectName: string | null,
  projectAddress: string | null,
): Promise<void> {
  // Loaded on demand so jsPDF isn't in the project page's initial chunk.
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 56
  const contentW = pageWidth - margin * 2
  let y = margin

  // Title
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('Change Order — Signed', margin, y)
  y += 30

  // Project context
  if (projectName) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(projectName, margin, y)
    y += 18
  }
  if (projectAddress) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(90)
    doc.text(projectAddress, margin, y)
    y += 16
    doc.setTextColor(0)
  }

  y += 6
  doc.setDrawColor(200)
  doc.line(margin, y, pageWidth - margin, y)
  y += 22

  // CO number + prominent amount
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(`Change Order${co.co_number ? ` ${co.co_number}` : ''}`, margin, y)
  doc.setFontSize(16)
  doc.text(usd.format(co.amount), pageWidth - margin, y, { align: 'right' })
  y += 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(`Date: ${formatDate(co.co_date)}`, margin, y)
  doc.setTextColor(0)
  y += 20

  // Description (wrapped)
  if (co.description) {
    doc.setFontSize(11)
    const lines = doc.splitTextToSize(co.description, contentW) as string[]
    doc.text(lines, margin, y)
    y += lines.length * 14 + 8
  }

  y += 6
  doc.setDrawColor(200)
  doc.line(margin, y, pageWidth - margin, y)
  y += 22

  // Approval statement
  doc.setFontSize(11)
  const stmt = doc.splitTextToSize(
    'This change order was electronically signed and approved by the customer.',
    contentW,
  ) as string[]
  doc.text(stmt, margin, y)
  y += stmt.length * 14 + 16

  // Signer details
  doc.setFontSize(11)
  doc.text(`Signed by: ${co.signed_name ?? '—'}`, margin, y)
  y += 16
  doc.text(`Date: ${fmtDateTime(co.signed_at)}`, margin, y)
  y += 16
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(`IP address: ${co.signed_ip ?? '—'}`, margin, y)
  doc.setTextColor(0)
  y += 26

  // Signature image (above the line), recolored so it's visible on white.
  if (co.signature_image) {
    const img = await recolorSignature(co.signature_image)
    try {
      doc.addImage(img, 'PNG', margin, y, 180, 70)
    } catch {
      // Ignore an unembeddable image — still produce the PDF.
    }
    y += 74
  }
  doc.setDrawColor(120)
  doc.line(margin, y, margin + 220, y)
  y += 12
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text('Customer signature', margin, y)
  doc.setTextColor(0)

  doc.save(`ChangeOrder_${co.co_number || co.id}_signed.pdf`)
}
