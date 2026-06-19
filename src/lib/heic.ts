// iPhones save photos as HEIC/HEIF, which many browsers can't render in an
// <img>. Detect those files by MIME type or extension.
function isHeic(file: File): boolean {
  const type = file.type.toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  return /\.(heic|heif)$/i.test(file.name)
}

/**
 * If `file` is a HEIC/HEIF image, convert it to a JPEG File (renamed `.jpg`,
 * mime `image/jpeg`) so it displays everywhere. Any non-HEIC file is returned
 * untouched. If conversion fails for any reason, the original file is returned
 * so the upload is never blocked.
 */
export async function ensureDisplayableImage(file: File): Promise<File> {
  if (!isHeic(file)) return file

  try {
    // Loaded on demand so the (large) HEIC decoder isn't in the initial bundle.
    const { default: heic2any } = await import('heic2any')
    const converted = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.9,
    })
    // heic2any returns a Blob, or a Blob[] for multi-image HEIC.
    const blob = Array.isArray(converted) ? converted[0] : converted
    const jpegName = file.name.replace(/\.(heic|heif)$/i, '') + '.jpg'
    return new File([blob], jpegName, {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } catch {
    // Conversion failed — fall back to the original so the upload still works.
    return file
  }
}
