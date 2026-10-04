// Autorização central (Equipe). Sem imports de servidor: o mesmo módulo é usado no cliente (usePermissions) para a
// interface acompanhar o papel. A barreira de verdade é o servidor (guard.ts / requireSpaceAccess).

export type Papel = 'owner' | 'admin' | 'agent'
export const PAPEIS: readonly Papel[] = ['owner', 'admin', 'agent']

export const PAPEL_LABEL: Record<Papel, string> = { owner: 'Dono', admin: 'Administrador', agent: 'Atendente' }

const ALL: readonly Papel[] = ['owner', 'admin', 'agent']
const MANAGERS: readonly Papel[] = ['owner', 'admin']
const OWNER: readonly Papel[] = ['owner']

/**
 * Tabela ação -> papéis. dono: tudo; administrador: tudo menos plano/cobrança e mexer no dono;
 * atendente: conversas, contatos e agenda (sem agente de IA, disparos, follow-up, WhatsApp, equipe, plano).
 */
export const PERMISSIONS = {
  // Todos
  'conversations.use': ALL,
  'contacts.use': ALL,
  'agenda.use': ALL,
  'wa.view': ALL,
  'space.switch': ALL,
  'quickreplies.use': ALL,
  // Dono e administrador
  'automations.toggle': MANAGERS,
  'agent.manage': MANAGERS,
  'followup.manage': MANAGERS,
  'campaigns.manage': MANAGERS,
  'settings.workspace': MANAGERS,
  'calendar.manage': MANAGERS,
  'wa.manage': MANAGERS,
  'spaces.manage': MANAGERS,
  'team.manage': MANAGERS,
  'results.view': MANAGERS,
  'servicetypes.manage': MANAGERS,
  'booking.manage': MANAGERS,
  'quickreplies.manage': MANAGERS,
  // Só o dono
  'billing.view': OWNER,
  'billing.manage': OWNER,
  'team.audit': OWNER,
} as const satisfies Record<string, readonly Papel[]>

export type Action = keyof typeof PERMISSIONS

/** Papel desconhecido vira o menos privilegiado (atendente). Linhas antigas sem papel já foram promovidas a dono na migração. */
export function normalizePapel(v: string | null | undefined): Papel {
  return v === 'owner' || v === 'admin' || v === 'agent' ? v : 'agent'
}

export function papelCan(papel: string | null | undefined, action: Action): boolean {
  return (PERMISSIONS[action] as readonly Papel[]).includes(normalizePapel(papel))
}

/** `can(sessão, ação)`: a sessão carrega `papel` (relido do banco a cada leitura da sessão). */
export function can(session: { papel?: string | null } | null | undefined, action: Action): boolean {
  return !!session && papelCan(session.papel, action)
}

export class PermissionError extends Error {
  readonly status = 403
  constructor(message = 'Você não tem permissão para isso') {
    super(message)
    this.name = 'PermissionError'
  }
}

export function requirePermission(session: { papel?: string | null } | null | undefined, action: Action): void {
  if (!can(session, action)) throw new PermissionError()
}

export function requireRole(session: { papel?: string | null } | null | undefined, ...papeis: Papel[]): void {
  if (!session || !papeis.includes(normalizePapel(session.papel))) throw new PermissionError()
}

/** Quem pode ser alvo de quem: o administrador não mexe no dono. */
export function canManageTarget(actor: Papel, target: Papel): boolean {
  if (actor === 'owner') return true
  if (actor === 'admin') return target !== 'owner'
  return false
}
