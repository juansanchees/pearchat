// Arquivo .ics (iCalendar, RFC 5545) de um agendamento: UTC, quebras CRLF, texto escapado e linhas dobradas em 75 octetos.

const esc = (s: string): string =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Dobra a linha em partes de até 75 octetos (UTF-8), sem cortar um caractere ao meio. */
function fold(line: string): string[] {
  if (Buffer.byteLength(line) <= 75) return [line]
  const out: string[] = []
  let cur = ''
  let curBytes = 0
  let limit = 75
  for (const ch of Array.from(line)) {
    const b = Buffer.byteLength(ch)
    if (curBytes + b > limit) {
      out.push(cur)
      cur = ' '
      curBytes = 1
      limit = 75
    }
    cur += ch
    curBytes += b
  }
  out.push(cur)
  return out
}

export function buildIcs(ev: {
  id: string
  inicio: Date
  duracaoMin: number
  servico: string
  negocio: string
  now?: Date
}): string {
  const fim = new Date(ev.inicio.getTime() + ev.duracaoMin * 60_000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PearChat//Agendamento//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.id}@pearchat.online`,
    `DTSTAMP:${stamp(ev.now ?? new Date())}`,
    `DTSTART:${stamp(ev.inicio)}`,
    `DTEND:${stamp(fim)}`,
    `SUMMARY:${esc(`${ev.servico} - ${ev.negocio}`)}`,
    `DESCRIPTION:${esc(`Agendamento de ${ev.servico} em ${ev.negocio}.`)}`,
    `LOCATION:${esc(ev.negocio)}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`${ev.servico} - ${ev.negocio}`)}`,
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.flatMap(fold).join('\r\n') + '\r\n'
}
