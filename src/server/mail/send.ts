// Envio de e-mail transacional via Resend (API HTTP). Sem dependências.
// Nunca registra conteúdo nem destinatário completo.
// MAIL_DRY_RUN=true (teste/desenvolvimento): NUNCA chama a rede, em qualquer modo (inclusive `--prod` local), e registra o
// texto do e-mail no log do servidor, para testar fluxos com código. Em produção de verdade a variável não é definida.

const RESEND_URL = 'https://api.resend.com/emails'
const TIMEOUT_MS = 10_000

export type MailErrorCode = 'not_configured' | 'timeout' | 'network' | 'rejected' | 'rate_limited'

export class MailError extends Error {
  constructor(
    public readonly code: MailErrorCode,
    public readonly status?: number,
  ) {
    super(`mail:${code}${status ? `:${status}` : ''}`)
    this.name = 'MailError'
  }
}

export type SendMailInput = { to: string; subject: string; html: string; text: string }
export type SendMailResult = { ok: true; id?: string; dryRun?: boolean } | { ok: false; error: MailError }

const isProd = () => process.env.NODE_ENV === 'production'
const dryRun = () => process.env.MAIL_DRY_RUN === 'true'

/** true quando há chave do Resend e remetente (MAIL_FROM) configurados. */
export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM)
}

/** Destinatário mascarado para log: "***@dominio.com". */
function mask(to: string): string {
  const at = to.lastIndexOf('@')
  return at > 0 ? `***${to.slice(at)}` : '***'
}

export async function sendMail({ to, subject, html, text }: SendMailInput): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM

  if (dryRun()) {
    console.info(`[mail][dry-run] para ${mask(to)} · "${subject}"\n${text}`)
    return { ok: true, dryRun: true }
  }

  if (!apiKey || !from) {
    console.warn('[mail] e-mail não enviado: serviço de e-mail não configurado')
    // Só em desenvolvimento no modo demonstração: mostra o texto no console do servidor para testar o fluxo.
    if (process.env.WA_MOCK === 'true' && !isProd()) console.info(`[mail][demo] para ${mask(to)} · "${subject}"\n${text}`)
    return { ok: false, error: new MailError('not_configured') }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const code: MailErrorCode = res.status === 429 ? 'rate_limited' : 'rejected'
      console.error(`[mail] Resend recusou o envio (HTTP ${res.status})`)
      return { ok: false, error: new MailError(code, res.status) }
    }
    const body = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, id: body?.id }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    console.error(`[mail] falha ao enviar (${aborted ? 'tempo esgotado' : 'rede'})`)
    return { ok: false, error: new MailError(aborted ? 'timeout' : 'network') }
  } finally {
    clearTimeout(timer)
  }
}
