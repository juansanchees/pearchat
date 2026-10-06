// Regra do que é CRÍTICO para o monitor externo (/api/health/check). Função pura: sem banco, sem relógio, testável.
// Princípio: só avisa o que exige ação de quem opera a plataforma e evita alarme falso. Nada de dado pessoal: o resultado
// são categorias e contagens (ex.: "whatsapp_desconectado=1").

/** Sinais já coletados. `null` = não foi possível/aplicável medir (tabela ausente, consulta falhou): NUNCA vira alarme. */
export type Signals = {
  dbOk: boolean
  uptimeSeg: number
  /** ENGINE_DISABLED=true de propósito: não alarma o agendador. */
  engineDisabled: boolean
  engineActive: boolean
  /** Idade (s) do último ciclo do agendador; null = nenhum ciclo ainda. */
  tickAgeSeg: number | null
  /** WhatsApp que já esteve conectado, está caído entre X min e Y h e tem a automação de IA LIGADA. */
  waCaidosComIa: number | null
  /** Jobs de IA/follow-up pendentes ou "executando" atrasados além do limite. */
  jobsAtrasados: number | null
  falhasEnvio: number | null
  enviosOk: number | null
  /** Chamadas de IA recusadas por crédito/chave (HTTP 401/402/403/429) na janela. */
  iaRecusadas: number | null
  inboxPendentes: number | null
  inboxMaisAntigoSeg: number | null
  /** Eventos que desistiram (INBOX_MAX_ATTEMPTS) nas últimas 24 h: mensagem que NÃO entrou e pede reprocesso manual. */
  inboxMortas24h?: number | null
  /** Horas desde o último backup BOM; null = sem arquivo de status (backup não instalado/visível: não alarma). */
  backupIdadeH: number | null
}

export type Thresholds = {
  /** Mínimo de jobs atrasados para declarar a fila parada. */
  jobsAtrasadosMin: number
  /** Falhas de envio na janela (sem NENHUM envio bem-sucedido na mesma janela). */
  falhasEnvioMin: number
  iaRecusadasMin: number
  inboxMax: number
  inboxIdadeSeg: number
  tickMaxSeg: number
  backupMaxH: number
  /** Segundos de uptime antes de cobrar o agendador (logo após subir ainda não houve ciclo). */
  bootGraceSeg: number
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  jobsAtrasadosMin: 3,
  falhasEnvioMin: 5,
  iaRecusadasMin: 3,
  inboxMax: 100,
  inboxIdadeSeg: 600,
  tickMaxSeg: 300,
  backupMaxH: 48,
  bootGraceSeg: 180,
}

/** Lista de problemas críticos ("banco_fora", "whatsapp_desconectado=1", ...). Vazia = tudo certo. */
export function evaluateCritical(s: Signals, t: Thresholds = DEFAULT_THRESHOLDS): string[] {
  if (!s.dbOk) return ['banco_fora'] // sem banco, o resto não é confiável (e o app já está inutilizável)
  const out: string[] = []
  if (!s.engineDisabled && s.uptimeSeg > t.bootGraceSeg && (!s.engineActive || s.tickAgeSeg === null || s.tickAgeSeg > t.tickMaxSeg)) {
    out.push('agendador_parado')
  }
  if (s.waCaidosComIa !== null && s.waCaidosComIa > 0) out.push(`whatsapp_desconectado=${s.waCaidosComIa}`)
  if (s.jobsAtrasados !== null && s.jobsAtrasados >= t.jobsAtrasadosMin) out.push(`fila_parada=${s.jobsAtrasados}`)
  // Falhas "em série": várias falhas e NENHUM envio bem-sucedido na janela (um número inválido isolado não conta).
  if (s.falhasEnvio !== null && s.enviosOk !== null && s.falhasEnvio >= t.falhasEnvioMin && s.enviosOk === 0) out.push(`falhas_de_envio=${s.falhasEnvio}`)
  if (s.iaRecusadas !== null && s.iaRecusadas >= t.iaRecusadasMin) out.push(`ia_sem_credito=${s.iaRecusadas}`)
  if (s.inboxPendentes !== null && s.inboxPendentes > 0 && (s.inboxPendentes >= t.inboxMax || (s.inboxMaisAntigoSeg ?? 0) > t.inboxIdadeSeg)) {
    out.push(`entrada_acumulada=${s.inboxPendentes}`)
  }
  if (s.inboxMortas24h != null && s.inboxMortas24h > 0) out.push(`entrada_morta=${s.inboxMortas24h}`)
  if (s.backupIdadeH !== null && s.backupIdadeH > t.backupMaxH) out.push('backup_atrasado')
  return out
}
