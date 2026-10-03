import type { AutomationKey, DrawerKey } from '@/lib/types'

export const AUTOMATION_KEYS: AutomationKey[] = ['ia', 'disparos', 'followup']

export const AUTOMATION_TITLES: Record<AutomationKey, string> = {
  ia: 'Agentes de IA',
  disparos: 'Disparos automáticos',
  followup: 'Follow-up automático',
}

export const DRAWER_TITLES: Record<DrawerKey, string> = {
  ...AUTOMATION_TITLES,
  config: 'Configurações',
  plano: 'Plano e pagamento',
}

export const DRAWER_DESCRIPTIONS: Record<DrawerKey, string> = {
  ia: 'Responde seus clientes com as suas instruções',
  disparos: 'Envie mensagens para contatos e listas',
  followup: 'Retoma conversas de quem parou de responder',
  config: 'Perfil, empresa, avisos e conexões',
  plano: 'Uso do mês, troca de plano e faturas',
}

export const fmtNum = (n: number) => n.toLocaleString('pt-BR')
