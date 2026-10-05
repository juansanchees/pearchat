// Login com Google (Auth.js). Usa o mesmo cliente OAuth da integração de Agenda, mas só pede openid/email/profile.
// Sem credenciais o provider não é registrado e a interface mostra o botão como "Em breve".

export function googleLoginCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export function googleLoginEnabled(): boolean {
  return googleLoginCredentials() !== null
}

// Mensagens (pt-BR) para os códigos de erro que o Auth.js devolve em /login?error=...
export function loginErrorMessage(code: string | undefined): string | undefined {
  if (!code) return undefined
  switch (code) {
    case 'CredentialsSignin':
      return 'E-mail ou senha incorretos.'
    case 'AccessDenied':
      return 'Não foi possível entrar com o Google. Confirme que o e-mail da sua conta Google está verificado e tente de novo.'
    case 'access_denied':
    case 'OAuthCallbackError':
    case 'OAuthCallback':
    case 'Callback':
      return 'O acesso com o Google foi cancelado ou não pôde ser concluído. Tente de novo.'
    case 'OAuthAccountNotLinked':
      return 'Já existe uma conta com esse e-mail. Entre com seu e-mail e senha.'
    case 'GoogleSemVinculo':
      return 'Já existe uma conta com esse e-mail que ainda não confirmou o endereço. Entre com seu e-mail e senha.'
    case 'GoogleMfa':
      return 'Entre com e-mail e senha para usar a verificação em duas etapas.'
      // (A ativação exige uma senha na conta, então ninguém fica sem caminho de entrada.)
    case 'Configuration':
      return 'Não foi possível concluir o login com o Google. Tente de novo ou entre com seu e-mail e senha.'
    case 'OAuthSignin':
    case 'OAuthCreateAccount':
    case 'SessionRequired':
      return 'Não foi possível iniciar o login com o Google. Tente de novo em instantes.'
    default:
      return 'Não foi possível entrar. Tente de novo.'
  }
}
