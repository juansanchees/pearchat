// Ações auditáveis e os textos da lista "Atividade recente". Sem imports de servidor: a tela também usa este arquivo.
export type AuditAction =
  | 'invite.created'
  | 'invite.resent'
  | 'invite.accepted'
  | 'invite.revoked'
  | 'member.role_changed'
  | 'member.spaces_changed'
  | 'member.removed'
  | 'wa.connected'
  | 'wa.disconnected'
  | 'space.created'
  | 'space.archived'
  | '2fa.enabled'
  | '2fa.disabled'
  | 'plan.changed'

export const AUDIT_LABEL: Record<AuditAction, string> = {
  'invite.created': 'convidou',
  'invite.resent': 'reenviou o convite de',
  'invite.accepted': 'aceitou o convite',
  'invite.revoked': 'revogou o convite de',
  'member.role_changed': 'alterou o papel de',
  'member.spaces_changed': 'alterou os WhatsApps de',
  'member.removed': 'removeu da equipe',
  'wa.connected': 'conectou o WhatsApp',
  'wa.disconnected': 'desconectou o WhatsApp',
  'space.created': 'criou o WhatsApp',
  'space.archived': 'arquivou o WhatsApp',
  '2fa.enabled': 'ativou a verificação em duas etapas',
  '2fa.disabled': 'desativou a verificação em duas etapas',
  'plan.changed': 'alterou o plano',
}
