import type { ReactNode } from 'react'
import { AppShell } from '@/components/app/app-shell'
import { AppStateProvider } from '@/components/app/app-state'
import { SessionInvalid } from '@/components/app/session-invalid'
import { ToastHost } from '@/components/app/toast-host'
import { DrawerDataProvider } from '@/components/drawers/drawer-data'
import { DrawerHost } from '@/components/drawers/drawer-host'
import type { PlanoNome } from '@/components/drawers/mock-data'
import { db } from '@/lib/db'
import { listCampaigns } from '@/server/campaigns/service'
import { countFollowUpQueue } from '@/server/followup/service'
import { providerToKind, statusToKind } from '@/lib/mappers'
import { requireSession } from '@/lib/session'
import { ensureOrganization } from '@/server/spaces/org'
import { listSpaces } from '@/server/spaces/service'
import { connectConfig } from '@/server/whatsapp/config'
import { needsEmailVerification } from '@/server/mail/email-verification'
import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import type { Plan } from '@prisma/client'

/** upsert que sobrevive a duas abas abrindo a conta nova ao mesmo tempo (violação de unicidade -> lê a linha criada pela outra). */
async function ensureRow<T>(create: () => Promise<T>, read: () => Promise<T | null>): Promise<T> {
  try {
    return await create()
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const row = await read()
      if (row) return row
    }
    throw e
  }
}

const PLANOS: Record<Plan, PlanoNome> = { ESSENCIAL: 'Essencial', PRO: 'Pro', NEGOCIOS: 'Negócios' }

// Shell do app (AppShell): sidebar escura de 288px (gaveta abaixo de 900px) + área principal clara; drawers e toasts ficam por cima.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { userId, workspaceId, organizationId: sessionOrgId } = await requireSession()
  // Contas novas sem e-mail confirmado (com e-mail configurado) vão para a confirmação; contas antigas não são afetadas.
  if (await needsEmailVerification(userId)) redirect('/verificar-email')

  // Cookie de sessão de uma conta que não existe mais: tela de "entrar de novo" em vez de erro de banco.
  const account = await db.user.findUnique({ where: { id: userId }, select: { workspaceId: true } })
  if (!account || account.workspaceId !== workspaceId) return <SessionInvalid />

  // Conta anterior à migração (sem organização): cria sob demanda.
  const organizationId = sessionOrgId ?? (await ensureOrganization(workspaceId))

  const [wa, agent, followUp, user, workspace, contatosCount, campanhas, fuQueueCount, org, spaces] = await Promise.all([
    ensureRow(
      () => db.whatsAppSession.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} }),
      () => db.whatsAppSession.findUnique({ where: { workspaceId } }),
    ),
    ensureRow(
      () => db.aiAgent.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} }),
      () => db.aiAgent.findUnique({ where: { workspaceId } }),
    ),
    ensureRow(
      () => db.followUpRule.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} }),
      () => db.followUpRule.findUnique({ where: { workspaceId } }),
    ),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { nome: true, email: true, fotoUrl: true, image: true } }),
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { nome: true, plano: true, horarioAtendimento: true, disparosAtivos: true } }),
    db.contact.count({ where: { workspaceId } }),
    listCampaigns(workspaceId),
    countFollowUpQueue(workspaceId),
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { nome: true, plano: true } }),
    listSpaces(organizationId, workspaceId),
  ])

  const connected = wa.status === 'CONECTADO'

  return (
    <AppStateProvider
      initial={{
        wa: { provider: wa.provider ? providerToKind(wa.provider) : null, status: statusToKind(wa.status), numero: wa.numero },
        automations: { ia: connected && agent.enabled, followup: connected && followUp.enabled, disparos: connected && workspace.disparosAtivos },
        user: { nome: user.nome, email: user.email, empresa: workspace.nome, organizacao: org.nome, fotoUrl: user.fotoUrl ?? user.image },
        agentName: agent.nome,
        fuQueueCount,
        spaces,
        workspaceId,
        connectCfg: connectConfig(user.email),
      }}
    >
      <DrawerDataProvider
        initial={{ plano: PLANOS[org.plano], horarioAtendimento: workspace.horarioAtendimento, contatosCount, campanhas }}
      >
        <AppShell>{children}</AppShell>
        <DrawerHost />
        <ToastHost />
      </DrawerDataProvider>
    </AppStateProvider>
  )
}
