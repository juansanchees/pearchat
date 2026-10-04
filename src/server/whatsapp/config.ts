// Configuração de conexão calculada no SERVIDOR a cada requisição (as NEXT_PUBLIC_* são embutidas no build e
// não servem sozinhas para decidir o que um usuário real vê).
export type SignupMode = 'sdk' | 'hosted'

export type ConnectConfig = {
  /** Modo demonstração (WA_MOCK=true): só aqui existem QR desenhado e "Simular leitura do QR". */
  demo: boolean
  /** App da Meta configurado (App ID e Config ID): só então o WhatsApp oficial pode ser conectado de verdade. */
  metaConfigured: boolean
  /**
   * Conexão oficial liberada PARA ESTE USUÁRIO: Meta configurada e (beta aberto a todos OU e-mail na lista de teste).
   * Enquanto META_OFICIAL_BETA=false, os demais usuários continuam vendo "Em breve".
   */
  oficialAtivo: boolean
  metaAppId: string
  metaConfigId: string
  /** sdk = FB.login (popup); hosted = link hospedado pela Meta. O sdk cai sozinho para o hospedado se falhar ao carregar. */
  signupMode: SignupMode
  /** Versão da Graph API usada no SDK do navegador (FB.init). */
  graphVersion: string
  /** Extras do FB.login: versão das informações de sessão e tipo de fluxo (vazio = o popup da Meta decide). */
  sessionInfoVersion: string
  featureType: string
}

const clean = (v: string | undefined) => (v ?? '').trim()

export function graphVersion(): string {
  const v = clean(process.env.META_GRAPH_VERSION)
  return /^v\d+\.\d+$/.test(v) ? v : 'v25.0'
}

export function signupMode(): SignupMode {
  return clean(process.env.META_SIGNUP_MODE).toLowerCase() === 'hosted' ? 'hosted' : 'sdk'
}

/** META_OFICIAL_BETA=true abre a conexão oficial a todos; senão só e-mails de META_OFICIAL_BETA_EMAILS (lista separada por vírgula). */
export function oficialAllowedFor(email: string | null | undefined): boolean {
  if (clean(process.env.META_OFICIAL_BETA).toLowerCase() === 'true') return true
  if (!email) return false
  const list = clean(process.env.META_OFICIAL_BETA_EMAILS)
    .split(/[,;\s]+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean)
  return list.includes(email.trim().toLowerCase())
}

export function metaIds(): { appId: string; configId: string } {
  return {
    appId: clean(process.env.NEXT_PUBLIC_META_APP_ID) || clean(process.env.META_APP_ID),
    configId: clean(process.env.NEXT_PUBLIC_META_CONFIG_ID) || clean(process.env.META_CONFIG_ID),
  }
}

export function connectConfig(email?: string | null): ConnectConfig {
  const { appId, configId } = metaIds()
  const metaConfigured = !!(appId && configId)
  return {
    demo: process.env.WA_MOCK === 'true',
    metaConfigured,
    oficialAtivo: metaConfigured && oficialAllowedFor(email),
    metaAppId: appId,
    metaConfigId: configId,
    signupMode: signupMode(),
    graphVersion: graphVersion(),
    sessionInfoVersion: clean(process.env.META_SESSION_INFO_VERSION) || '3',
    featureType: clean(process.env.META_FEATURE_TYPE),
  }
}

/** Link do Cadastro incorporado hospedado pela Meta (extras no formato que o painel do app gera). */
export function hostedSignupUrl(): string {
  const { appId, configId } = metaIds()
  const extras = encodeURIComponent(JSON.stringify({ sessionInfoVersion: clean(process.env.META_SESSION_INFO_VERSION) || '3', version: 'v4' }))
  return `https://business.facebook.com/messaging/whatsapp/onboard/?app_id=${encodeURIComponent(appId)}&config_id=${encodeURIComponent(configId)}&extras=${extras}`
}
