import { buildQrMatrix, QR_SIZE } from './qr-matrix'

// SVG (data URL) do QR ilustrativo, devolvido pelo MockProvider.
export function buildQrSvgDataUrl(): string {
  const m = buildQrMatrix()
  let rects = ''
  m.forEach((row, r) =>
    row.forEach((on, c) => {
      if (on) rects += `<rect x="${c}" y="${r}" width="1" height="1"/>`
    }),
  )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${QR_SIZE} ${QR_SIZE}" shape-rendering="crispEdges"><rect width="${QR_SIZE}" height="${QR_SIZE}" fill="#ffffff"/><g fill="#1d2117">${rects}</g></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}
