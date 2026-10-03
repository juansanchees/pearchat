// QR falso (não escaneável) da spec 02, seção E. Módulo puro: usado pelo MockProvider (SVG) e pela tela (grade).
export const QR_SIZE = 25

export function buildQrMatrix(): boolean[][] {
  let seed = 11
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  const finders: Array<[number, number]> = [
    [0, 0],
    [0, 18],
    [18, 0],
  ]
  const rows: boolean[][] = []
  for (let r = 0; r < QR_SIZE; r++) {
    const row: boolean[] = []
    for (let c = 0; c < QR_SIZE; c++) {
      let on: boolean | null = null
      for (const [fr, fc] of finders) {
        if (r >= fr && r < fr + 7 && c >= fc && c < fc + 7) {
          const lr = r - fr
          const lc = c - fc
          const border = lr === 0 || lr === 6 || lc === 0 || lc === 6
          const center = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4
          on = border || center
        }
      }
      if (on === null) {
        const quiet = (r < 8 && c < 8) || (r < 8 && c >= 17) || (r >= 17 && c < 8)
        if (quiet) on = false
        else if (r >= 10 && r <= 14 && c >= 10 && c <= 14) on = false
        else on = rnd() > 0.5
      }
      row.push(on)
    }
    rows.push(row)
  }
  return rows
}
