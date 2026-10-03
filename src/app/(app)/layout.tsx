import type { ReactNode } from 'react'
import { AppShell } from '@/components/app/app-shell'
import { AppStateProvider } from '@/components/app/app-state'
import { ToastHost } from '@/components/app/toast-host'
import { DrawerDataProvider } from '@/components/drawers/drawer-data'
import { DrawerHost } from '@/components/drawers/drawer-host'
import type { PlanoNome } from '@/components/drawers/mock-data'
import { db } from '@/lib/db'
import { listCampaigns } from '@/server/campaigns/service'
import { countFollowUpQueue } from '@/server/followup/service'
import { providerToKind, statusToKind } from '@/lib/mappers'
import { requireSession } from '@/lib/session'
import type { Plan } from '@prisma/client'

const PLANOS: Record<Plan, PlanoNome> = { ESSENCIAL: 'Essencial', PRO: 'Pro', NEGOCIOS: 'Negócios' }

// Shell do app (AppShell): sidebar escura de 288px (gaveta abaixo de 900px) + área principal clara; drawers e toasts ficam por cima.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { userId, workspaceId } = await requireSession()

  const [wa, agent, followUp, user, workspace, contatosCount, campanhas, fuQueueCount] = await Promise.all([
    db.whatsAppSession.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} }),
    db.aiAgent.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} }),
    db.followUpRule.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} }),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { nome: true, email: true, fotoUrl: true, image: true } }),
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { nome: true, plano: true, horarioAtendimento: true, disparosAtivos: true } }),
    db.contact.count({ where: { workspaceId } }),
    listCampaigns(workspaceId),
    countFollowUpQueue(workspaceId),
  ])

  const connected = wa.status === 'CONECTADO'

  return (
    <AppStateProvider
      initial={{
        wa: { provider: wa.provider ? providerToKind(wa.provider) : null, status: statusToKind(wa.status), numero: wa.numero },
        automations: { ia: connected && agent.enabled, followup: connected && followUp.enabled, disparos: connected && workspace.disparosAtivos },
        user: { nome: user.nome, email: user.email, empresa: workspace.nome, fotoUrl: user.fotoUrl ?? user.image },
        agentName: agent.nome,
        fuQueueCount,
      }}
    >
      <DrawerDataProvider
        initial={{ plano: PLANOS[workspace.plano], horarioAtendimento: workspace.horarioAtendimento, contatosCount, campanhas }}
      >
        <AppShell>{children}</AppShell>
        <DrawerHost />
        <ToastHost />
      </DrawerDataProvider>
    </AppStateProvider>
  )
}
