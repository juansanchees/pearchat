// Envio do e-mail de redefinição de senha.
// Usa o Resend (API HTTP) quando RESEND_API_KEY e MAIL_FROM existem. Sem eles, só registra
// no log do servidor que o e-mail não foi enviado — nunca o token.

export type PasswordResetEmail = { to: string; link: string }

export async function sendPasswordResetEmail({ to, link }: PasswordResetEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM

  if (!apiKey || !from) {
    console.warn('[mail] e-mail de redefinição não enviado: serviço de e-mail não configurado')
    // Só em desenvolvimento com o modo demonstração: mostra o link no console para testar o fluxo.
    if (process.env.WA_MOCK === 'true' && process.env.NODE_ENV !== 'production') {
      console.info(`[mail][demo] link de redefinição para ${to}: ${link}`)
    }
    return false
  }

  const text =
    `Recebemos um pedido para redefinir a senha da sua conta no PearChat.\n\n` +
    `Crie uma senha nova neste link (vale por 30 minutos):\n${link}\n\n` +
    `Se não foi você, ignore este e-mail: sua senha continua a mesma.`
  const html =
    `<p>Recebemos um pedido para redefinir a senha da sua conta no PearChat.</p>` +
    `<p><a href="${link}">Criar uma senha nova</a> (o link vale por 30 minutos).</p>` +
    `<p>Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: 'Redefinir sua senha do PearChat', html, text }),
    })
    if (!res.ok) {
      console.error(`[mail] falha ao enviar e-mail de redefinição (HTTP ${res.status})`)
      return false
    }
    return true
  } catch {
    console.error('[mail] falha de rede ao enviar e-mail de redefinição')
    return false
  }
}
