// Modelos de e-mail do PearChat: HTML com tabelas e estilos inline (compatível com clientes de e-mail), 560px, pt-BR.

export type MailContent = { subject: string; html: string; text: string }

const RAZAO_SOCIAL = 'INFODREAMZ NEGOCIOS DIGITAIS LTDA'
const CNPJ = '40.741.391/0001-10'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || 'https://pearchat.online').replace(/\/+$/, '')
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const p = (html: string) =>
  `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:#3a4030;">${html}</p>`
const h1 = (t: string) =>
  `<h1 style="margin:0 0 14px;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.01em;color:#1d2117;">${escapeHtml(t)}</h1>`
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>` +
  `<td align="center" bgcolor="#2e9a48" style="border-radius:10px;background:#2e9a48;">` +
  `<a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>` +
  `</td></tr></table>`
const muted = (html: string) =>
  `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.55;color:#7a8268;">${html}</p>`

function layout(preheader: string, body: string): string {
  const base = appBaseUrl()
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>PearChat</title>
</head>
<body style="margin:0;padding:0;background:#f6f7ef;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f6f7ef;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f7ef" style="background:#f6f7ef;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
    <tr><td style="padding:0 4px 12px;font-family:${FONT};font-size:20px;font-weight:600;color:#1d2117;letter-spacing:-0.01em;">
      <a href="${base}" target="_blank" style="text-decoration:none;color:#1d2117;"><img src="${base}/brand/pearchat-horizontal.png" alt="PearChat" width="160" style="display:block;border:0;outline:none;text-decoration:none;width:160px;max-width:160px;height:auto;font-family:${FONT};font-size:20px;font-weight:600;color:#1d2117;"></a>
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e3e7d6;border-radius:16px;padding:32px 32px 20px;">
      ${body}
    </td></tr>
    <tr><td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#8a917a;text-align:center;">
      ${RAZAO_SOCIAL} &middot; CNPJ ${CNPJ}<br>
      <a href="${base}/privacidade" target="_blank" style="color:#1e6b3a;text-decoration:underline;">Política de privacidade</a>
      &middot; <a href="${base}" target="_blank" style="color:#1e6b3a;text-decoration:underline;">${base.replace(/^https?:\/\//, '')}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`
}

const textFooter = () =>
  `\n--\n${RAZAO_SOCIAL} · CNPJ ${CNPJ}\nPolítica de privacidade: ${appBaseUrl()}/privacidade\n`

export function passwordResetEmail({ link }: { link: string }): MailContent {
  const html = layout(
    'Crie uma senha nova para a sua conta. O link vale por 30 minutos.',
    h1('Redefinir sua senha') +
      p('Recebemos um pedido para redefinir a senha da sua conta no PearChat. Clique no botão abaixo para criar uma senha nova.') +
      button(link, 'Criar uma senha nova') +
      muted('O link vale por <strong>30 minutos</strong> e só pode ser usado uma vez.') +
      muted(`Se o botão não abrir, copie este endereço no navegador:<br><span style="word-break:break-all;color:#1e6b3a;">${escapeHtml(link)}</span>`) +
      `<hr style="border:0;border-top:1px solid #eef0e3;margin:20px 0 14px;">` +
      muted('Não foi você? Ignore este e-mail: sua senha continua a mesma.'),
  )
  const text =
    `Redefinir sua senha\n\nRecebemos um pedido para redefinir a senha da sua conta no PearChat.\n\n` +
    `Crie uma senha nova neste link (vale por 30 minutos, uso único):\n${link}\n\n` +
    `Não foi você? Ignore este e-mail: sua senha continua a mesma.\n` +
    textFooter()
  return { subject: 'Redefinir sua senha do PearChat', html, text }
}

export function verificationCodeEmail({ code, nome }: { code: string; nome?: string }): MailContent {
  const spaced = code.split('').join(' ')
  const primeiro = nome?.trim().split(/\s+/)[0]
  const oi = primeiro ? `Oi, ${escapeHtml(primeiro)}! ` : ''
  const html = layout(
    `Seu código de confirmação: ${code}. Vale por 10 minutos.`,
    h1('Confirme seu e-mail') +
      p(`${oi}Digite este código no PearChat para confirmar seu e-mail:`) +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 20px;"><tr>` +
      `<td align="center" bgcolor="#f0faea" style="background:#f0faea;border:1px solid #b9e3a6;border-radius:12px;padding:20px 8px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:36px;line-height:1;font-weight:700;letter-spacing:10px;color:#1d2117;">${escapeHtml(code)}</td>` +
      `</tr></table>` +
      muted('O código vale por <strong>10 minutos</strong>. Por segurança, não o compartilhe com ninguém.') +
      `<hr style="border:0;border-top:1px solid #eef0e3;margin:20px 0 14px;">` +
      muted('Não criou uma conta no PearChat? Pode ignorar este e-mail.'),
  )
  const text =
    `Confirme seu e-mail\n\n${primeiro ? `Oi, ${primeiro}! ` : ''}Seu código de confirmação do PearChat é:\n\n    ${spaced}\n\n` +
    `Ele vale por 10 minutos. Não o compartilhe com ninguém.\n` +
    `Não criou uma conta no PearChat? Pode ignorar este e-mail.\n` +
    textFooter()
  return { subject: `${code} é o seu código do PearChat`, html, text }
}

export function welcomeEmail({ nome }: { nome?: string }): MailContent {
  const base = appBaseUrl()
  const primeiro = nome?.trim().split(/\s+/)[0]
  const step = (n: number, titulo: string, desc: string) =>
    `<tr><td valign="top" width="40" style="padding:0 0 16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="28" height="28" bgcolor="#f0faea" style="width:28px;height:28px;background:#f0faea;border:1px solid #b9e3a6;border-radius:14px;font-family:${FONT};font-size:13px;font-weight:600;color:#185530;">${n}</td></tr></table></td>` +
    `<td valign="top" style="padding:3px 0 16px;font-family:${FONT};font-size:15px;line-height:1.5;color:#3a4030;"><strong style="color:#1d2117;">${escapeHtml(titulo)}</strong><br><span style="font-size:14px;color:#5d6650;">${escapeHtml(desc)}</span></td></tr>`
  const titulo = primeiro ? `Bem-vindo, ${primeiro}!` : 'Bem-vindo ao PearChat!'
  const html = layout(
    'Sua conta está pronta. Veja os 3 primeiros passos.',
    h1(titulo) +
      p('Sua conta está pronta. Para colocar o atendimento para funcionar, siga estes 3 passos:') +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 8px;">` +
      step(1, 'Conecte o WhatsApp', 'Escaneie o QR Code e seu número fica ligado ao PearChat.') +
      step(2, 'Ensine o agente', 'Conte como é o seu negócio, preços e horários para a IA responder do seu jeito.') +
      step(3, 'Conecte a agenda', 'Ligue o Google Agenda para marcar horários direto pelo WhatsApp.') +
      `</table>` +
      button(base, 'Abrir o PearChat') +
      muted('Dúvidas? Fale com a gente pelo e-mail de suporte indicado na política de privacidade.'),
  )
  const text =
    `${titulo}\n\nSua conta está pronta. Siga estes 3 passos:\n\n` +
    `1. Conecte o WhatsApp: escaneie o QR Code e seu número fica ligado ao PearChat.\n` +
    `2. Ensine o agente: conte como é o seu negócio, preços e horários.\n` +
    `3. Conecte a agenda: ligue o Google Agenda para marcar horários pelo WhatsApp.\n\n` +
    `Abrir o PearChat: ${base}\n` +
    textFooter()
  return { subject: 'Bem-vindo ao PearChat', html, text }
}

/** Convite para entrar na equipe de uma conta (Equipe). O link vale 7 dias e só pode ser usado uma vez. */
export function teamInviteEmail({ link, organizacao, convidadoPor, papel }: { link: string; organizacao: string; convidadoPor?: string; papel: string }): MailContent {
  const quem = convidadoPor?.trim() ? `${convidadoPor.trim()} convidou você` : 'Você foi convidado'
  const html = layout(
    `${quem} para a equipe de ${organizacao} no PearChat. O link vale por 7 dias.`,
    h1(`Entre na equipe de ${organizacao}`) +
      p(`${escapeHtml(quem)} para atender no PearChat como <strong>${escapeHtml(papel)}</strong>. Clique no botão abaixo para criar seu acesso.`) +
      button(link, 'Aceitar convite') +
      muted('O link vale por <strong>7 dias</strong> e só pode ser usado uma vez.') +
      muted(`Se o botão não abrir, copie este endereço no navegador:<br><span style="word-break:break-all;color:#1e6b3a;">${escapeHtml(link)}</span>`) +
      `<hr style="border:0;border-top:1px solid #eef0e3;margin:20px 0 14px;">` +
      muted('Não esperava este convite? Ignore este e-mail: nada será criado.'),
  )
  const text =
    `Entre na equipe de ${organizacao}\n\n${quem} para atender no PearChat como ${papel}.\n\n` +
    `Aceite neste link (vale por 7 dias, uso único):\n${link}\n\n` +
    `Não esperava este convite? Ignore este e-mail: nada será criado.\n` +
    textFooter()
  return { subject: `Convite para a equipe de ${organizacao} no PearChat`, html, text }
}

/** Aviso de segurança: verificação em duas etapas ativada ou desativada. */
export function twoFactorChangedEmail({ ativada, nome }: { ativada: boolean; nome?: string }): MailContent {
  const primeiro = nome?.trim().split(/\s+/)[0]
  const oi = primeiro ? `Oi, ${escapeHtml(primeiro)}! ` : ''
  const titulo = ativada ? 'Verificação em duas etapas ativada' : 'Verificação em duas etapas desativada'
  const corpo = ativada
    ? 'A verificação em duas etapas foi <strong>ativada</strong> na sua conta. A partir de agora, além da senha, pediremos um código do seu aplicativo autenticador ao entrar.'
    : 'A verificação em duas etapas foi <strong>desativada</strong> na sua conta e todos os dispositivos foram desconectados. Agora basta a senha para entrar.'
  const html = layout(
    `${titulo} na sua conta do PearChat.`,
    h1(titulo) +
      p(`${oi}${corpo}`) +
      `<hr style="border:0;border-top:1px solid #eef0e3;margin:20px 0 14px;">` +
      muted('Não foi você? Redefina a sua senha agora em <strong>Esqueci minha senha</strong> e fale com o suporte indicado na política de privacidade.'),
  )
  const plano = corpo.replace(/<\/?strong>/g, '')
  const text =
    `${titulo}\n\n${primeiro ? `Oi, ${primeiro}! ` : ''}${plano}\n\n` +
    `Não foi você? Redefina a sua senha em "Esqueci minha senha" e fale com o suporte indicado na política de privacidade.\n` +
    textFooter()
  return { subject: ativada ? 'Verificação em duas etapas ativada no PearChat' : 'Verificação em duas etapas desativada no PearChat', html, text }
}

/** Código para confirmar o NOVO e-mail de login (vai ao endereço novo). */
export function emailChangeCodeEmail({ code, nome }: { code: string; nome?: string }): MailContent {
  const spaced = code.split('').join(' ')
  const primeiro = nome?.trim().split(/\s+/)[0]
  const oi = primeiro ? `Oi, ${escapeHtml(primeiro)}! ` : ''
  const html = layout(
    `Seu código para trocar o e-mail do PearChat: ${code}. Vale por 10 minutos.`,
    h1('Confirme o novo e-mail') +
      p(`${oi}Alguém pediu para usar este endereço como e-mail de login da conta no PearChat. Se foi você, digite este código no PearChat:`) +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 20px;"><tr>` +
      `<td align="center" bgcolor="#f0faea" style="background:#f0faea;border:1px solid #b9e3a6;border-radius:12px;padding:20px 8px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:36px;line-height:1;font-weight:700;letter-spacing:10px;color:#1d2117;">${escapeHtml(code)}</td>` +
      `</tr></table>` +
      muted('O código vale por <strong>10 minutos</strong>. Por segurança, não o compartilhe com ninguém.') +
      `<hr style="border:0;border-top:1px solid #eef0e3;margin:20px 0 14px;">` +
      muted('Não foi você? Pode ignorar este e-mail: nada será alterado.'),
  )
  const text =
    `Confirme o novo e-mail\n\n${primeiro ? `Oi, ${primeiro}! ` : ''}Alguém pediu para usar este endereço como e-mail de login da conta no PearChat. Se foi você, digite este código:\n\n    ${spaced}\n\n` +
    `Ele vale por 10 minutos. Não o compartilhe com ninguém.\nNão foi você? Pode ignorar este e-mail: nada será alterado.\n` +
    textFooter()
  return { subject: `${code} é o código para trocar o e-mail do PearChat`, html, text }
}

/** Aviso ao e-mail ANTIGO: houve um pedido de troca do e-mail de login, ou a troca foi concluída. `novoEmail` já vem mascarado. */
export function emailChangeNoticeEmail({ concluida, novoEmail, nome }: { concluida: boolean; novoEmail: string; nome?: string }): MailContent {
  const primeiro = nome?.trim().split(/\s+/)[0]
  const oi = primeiro ? `Oi, ${escapeHtml(primeiro)}! ` : ''
  const titulo = concluida ? 'O e-mail da sua conta foi trocado' : 'Pedido para trocar o e-mail da sua conta'
  const corpo = concluida
    ? `O e-mail de login da sua conta no PearChat foi trocado para <strong>${escapeHtml(novoEmail)}</strong> e os outros dispositivos foram desconectados.`
    : `Alguém pediu para trocar o e-mail de login da sua conta no PearChat para <strong>${escapeHtml(novoEmail)}</strong>. A troca só acontece depois que o código enviado a esse endereço for confirmado.`
  const html = layout(
    `${titulo}.`,
    h1(titulo) +
      p(`${oi}${corpo}`) +
      `<hr style="border:0;border-top:1px solid #eef0e3;margin:20px 0 14px;">` +
      muted('Não foi você? Redefina a sua senha agora em <strong>Esqueci minha senha</strong> e fale com o suporte indicado na política de privacidade.'),
  )
  const plano = corpo.replace(/<\/?strong>/g, '')
  const text =
    `${titulo}\n\n${primeiro ? `Oi, ${primeiro}! ` : ''}${plano}\n\n` +
    `Não foi você? Redefina a sua senha em "Esqueci minha senha" e fale com o suporte indicado na política de privacidade.\n` +
    textFooter()
  return { subject: concluida ? 'O e-mail da sua conta do PearChat foi trocado' : 'Pedido para trocar o e-mail da sua conta do PearChat', html, text }
}

// ---- Cobrança (Asaas). Sem dados de pagamento no e-mail: só plano, datas e o link da conta. ----

type BillingMailKind = 'trial_acabando' | 'pagamento_confirmado' | 'pagamento_atrasado' | 'assinatura_cancelada'
export function billingEmail(kind: BillingMailKind, d: { nome?: string; plano?: string; dias?: number; ate?: string; graca?: number }): MailContent {
  const base = appBaseUrl()
  const primeiro = d.nome?.trim().split(/\s+/)[0]
  const oi = primeiro ? `Oi, ${primeiro}! ` : ''
  const abrir = (label: string) => button(base, label)
  let subject = ''
  let titulo = ''
  let corpo = ''
  let texto = ''
  if (kind === 'trial_acabando') {
    const quando = d.dias === 1 ? 'amanhã' : `em ${d.dias ?? 3} dias`
    subject = 'Seu período de teste do PearChat termina em breve'
    titulo = 'Seu teste termina em breve'
    corpo = `${oi}Seu período de teste termina <strong>${quando}</strong>. Para manter a IA, os follow-ups e os disparos funcionando, escolha um plano em <strong>Plano e pagamento</strong>.`
    texto = `${oi}Seu período de teste termina ${quando}. Para manter a IA, os follow-ups e os disparos funcionando, escolha um plano em Plano e pagamento.`
  } else if (kind === 'pagamento_confirmado') {
    subject = 'Pagamento confirmado no PearChat'
    titulo = 'Pagamento confirmado'
    corpo = `${oi}Recebemos o pagamento do plano <strong>${escapeHtml(d.plano ?? '')}</strong>.${d.ate ? ` Seu acesso está garantido até <strong>${escapeHtml(d.ate)}</strong>.` : ''} Obrigado!`
    texto = `${oi}Recebemos o pagamento do plano ${d.plano ?? ''}.${d.ate ? ` Seu acesso está garantido até ${d.ate}.` : ''} Obrigado!`
  } else if (kind === 'pagamento_atrasado') {
    subject = 'Pagamento em atraso no PearChat'
    titulo = 'Pagamento em atraso'
    corpo = `${oi}Não identificamos o pagamento da sua assinatura. Regularize em <strong>Plano e pagamento</strong>${d.graca ? ` em até <strong>${d.graca} dias</strong>` : ''} para manter a IA, os follow-ups e os disparos ligados. Suas conversas e dados continuam guardados e você segue recebendo e respondendo mensagens normalmente.`
    texto = `${oi}Não identificamos o pagamento da sua assinatura. Regularize em Plano e pagamento${d.graca ? ` em até ${d.graca} dias` : ''} para manter a IA, os follow-ups e os disparos ligados. Suas conversas e dados continuam guardados.`
  } else {
    subject = 'Assinatura cancelada no PearChat'
    titulo = 'Assinatura cancelada'
    corpo = `${oi}Sua assinatura foi cancelada.${d.ate ? ` Você continua com acesso completo até <strong>${escapeHtml(d.ate)}</strong>.` : ''} Seus dados ficam guardados e você pode reativar quando quiser em <strong>Plano e pagamento</strong>.`
    texto = `${oi}Sua assinatura foi cancelada.${d.ate ? ` Você continua com acesso completo até ${d.ate}.` : ''} Seus dados ficam guardados e você pode reativar quando quiser em Plano e pagamento.`
  }
  const html = layout(titulo, h1(titulo) + p(corpo) + abrir('Abrir o PearChat'))
  return { subject, html, text: `${titulo}\n\n${texto}\n\nAbrir o PearChat: ${base}\n${textFooter()}` }
}
