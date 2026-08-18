/**
 * VENDORED COPY — kept in sync by hand across the web repos:
 *   - mandir-web/src/lib/imageCompress.ts
 *   - devotee-web/src/lib/imageCompress.ts
 *   - sant-web/src/lib/imageCompress.ts
 * There is no shared frontend package (each app is its own GitHub repo).
 * If you change this file, port the change to the siblings above or they drift.
 * See doc-v2/Images_And_Photos.md §6.8.
 */
/**
 * Compress a picked image to a JPEG data URI small enough to store inline.
 *
 * Bills are photographed on phones (4–12 MP), which would be megabytes of
 * base64 in the DB. We downscale to `maxDim` and step the JPEG quality down
 * until the result fits `maxBytes`, mirroring what the devotee payment-proof
 * picker already does.
 *
 * PDFs can't be canvas-rendered, so they're read straight through — the caller
 * is responsible for rejecting oversized ones.
 */
export async function compressImage(
  file: File,
  { maxDim = 1600, maxBytes = 300_000 }: { maxDim?: number; maxBytes?: number } = {},
): Promise<string> {
  if (file.type === 'application/pdf') return readAsDataUrl(file)

  const dataUrl = await readAsDataUrl(file)
  const img = await loadImage(dataUrl)

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  for (const q of [0.8, 0.65, 0.5, 0.4, 0.3]) {
    const out = canvas.toDataURL('image/jpeg', q)
    // base64 is ~4/3 of the byte size; good enough to gate on.
    if (out.length * 0.75 <= maxBytes) return out
  }
  return canvas.toDataURL('image/jpeg', 0.3)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(new Error('Could not read file'))
    r.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = src
  })
}
