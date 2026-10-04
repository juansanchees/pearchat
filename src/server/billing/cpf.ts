// Validação de CPF/CNPJ (dígitos verificadores). Nunca registrar o valor em log.

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, '')
}

function cpfOk(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  for (const t of [9, 10]) {
    let sum = 0
    for (let i = 0; i < t; i++) sum += Number(d[i]) * (t + 1 - i)
    const dv = ((sum * 10) % 11) % 10
    if (dv !== Number(d[t])) return false
  }
  return true
}

function cnpjOk(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  for (const t of [12, 13]) {
    let sum = 0
    let w = t - 7
    for (let i = 0; i < t; i++) {
      sum += Number(d[i]) * w--
      if (w < 2) w = 9
    }
    const dv = sum % 11 < 2 ? 0 : 11 - (sum % 11)
    if (dv !== Number(d[t])) return false
  }
  return true
}

/** Devolve só os dígitos se for CPF ou CNPJ válido; senão null. */
export function parseCpfCnpj(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const d = onlyDigits(input)
  return cpfOk(d) || cnpjOk(d) ? d : null
}

// Máscara só para exibir que há um documento cadastrado (CPF: final 2 dígitos; CNPJ: final 2 dígitos).
export function maskCpfCnpj(d: string): string {
  return d.length === 11 ? `***.***.***-${d.slice(9)}` : `**.***.***/****-${d.slice(12)}`
}
