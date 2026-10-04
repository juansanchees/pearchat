// Configuração de conexão calculada no SERVIDOR a cada requisição (as NEXT_PUBLIC_* são embutidas no build e
// não servem sozinhas para decidir o que um usuário real vê).
export type ConnectConfig = {
  /** Modo demonstração (WA_MOCK=true): só aqui existem QR desenhado e "Simular leitura do QR". */
  demo: boolean
  /** App da Meta configurado (App ID e Config ID): só então o WhatsApp oficial pode ser conectado de verdade. */
  metaConfigured: boolean
  metaAppId: string
  metaConfigId: string
}

export function connectConfig(): ConnectConfig {
  const metaAppId = (process.env.NEXT_PUBLIC_META_APP_ID || process.env.META_APP_ID || '').trim()
  const metaConfigId = (process.env.NEXT_PUBLIC_META_CONFIG_ID || process.env.META_CONFIG_ID || '').trim()
  return { demo: process.env.WA_MOCK === 'true', metaConfigured: !!(metaAppId && metaConfigId), metaAppId, metaConfigId }
}
