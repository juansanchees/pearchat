import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

type SeedMsg = { from: 'cliente' | 'eu' | 'ia'; texto: string; hora: string }
type SeedChat = { nome: string; tel: string; unread: number; mode: 'IA' | 'HUMANO' | null; msgs: SeedMsg[] }

// Chats fictícios da spec 05 (c1...c7). 'Ontem' vira o dia anterior.
const SEED_CHATS: SeedChat[] = [
  { nome: 'Ana Paula Ribeiro', tel: '+5511998124471', unread: 2, mode: null, msgs: [
    { from: 'cliente', texto: 'Oi! Vocês fazem bolo de pote para festa?', hora: '10:12' },
    { from: 'cliente', texto: 'Seria para umas 40 pessoas, dia 18.', hora: '10:13' },
  ] },
  { nome: 'Carlos Menezes', tel: '+5511982205567', unread: 1, mode: null, msgs: [
    { from: 'cliente', texto: 'Boa tarde. Qual o valor do bolo de 2 kg de ninho com morango?', hora: '10:05' },
  ] },
  { nome: 'Juliana Freitas', tel: '+5511977442210', unread: 1, mode: 'IA', msgs: [
    { from: 'cliente', texto: 'Vocês entregam no Tatuapé?', hora: '09:40' },
    { from: 'ia', texto: 'Entregamos sim, Juliana! A taxa para o Tatuapé é de R$ 12. Para qual dia você precisa?', hora: '09:40' },
    { from: 'cliente', texto: 'Perfeito, quero para sábado de manhã.', hora: '09:52' },
  ] },
  { nome: 'Fernanda Lopes', tel: '+5511966338812', unread: 1, mode: null, msgs: [
    { from: 'cliente', texto: 'Consigo pagar no Pix?', hora: '09:31' },
  ] },
  { nome: 'Rodrigo Alves', tel: '+5511970014410', unread: 0, mode: 'HUMANO', msgs: [
    { from: 'eu', texto: 'Rodrigo, seu bolo saiu para entrega agora.', hora: '08:58' },
    { from: 'cliente', texto: 'Recebi! Ficou lindo, obrigado.', hora: '09:20' },
  ] },
  { nome: 'Beatriz Sousa', tel: '+5511981107742', unread: 1, mode: null, msgs: [
    { from: 'cliente', texto: 'Oi! Vi o cardápio de vocês no Instagram.', hora: 'Ontem 18:20' },
  ] },
  { nome: 'Marcos Tavares', tel: '+5511984552093', unread: 0, mode: 'HUMANO', msgs: [
    { from: 'cliente', texto: 'Pode ser às 15h?', hora: 'Ontem 14:40' },
    { from: 'eu', texto: 'Pode sim. Seu pedido sai às 15h.', hora: 'Ontem 14:45' },
  ] },
]

function seedDate(hora: string): Date {
  const ontem = hora.startsWith('Ontem')
  const [h, m] = hora.replace('Ontem', '').trim().split(':').map(Number)
  const d = new Date()
  if (ontem) d.setDate(d.getDate() - 1)
  d.setHours(h, m, 0, 0)
  return d
}

// Idempotente: pula contatos (por telefone) que já existem no workspace.
async function seedConversations(workspaceId: string) {
  let criadas = 0
  for (const chat of SEED_CHATS) {
    const exists = await prisma.contact.findUnique({
      where: { workspaceId_telefone: { workspaceId, telefone: chat.tel } },
      include: { conversation: { select: { id: true } } },
    })
    if (exists?.conversation) continue

    const dates = chat.msgs.map((msg) => seedDate(msg.hora))
    const contact =
      exists ??
      (await prisma.contact.create({ data: { workspaceId, nome: chat.nome, telefone: chat.tel } }))
    await prisma.conversation.create({
      data: {
        workspaceId,
        contactId: contact.id,
        mode: chat.mode,
        unread: chat.unread,
        lastMessageAt: dates[dates.length - 1],
        messages: {
          create: chat.msgs.map((msg, i) => ({
            direction: msg.from === 'cliente' ? ('IN' as const) : ('OUT' as const),
            author: msg.from === 'cliente' ? ('CLIENTE' as const) : msg.from === 'ia' ? ('IA' as const) : ('USER' as const),
            body: msg.texto,
            status: msg.from === 'cliente' ? ('ENTREGUE' as const) : ('LIDA' as const),
            createdAt: dates[i],
          })),
        },
      },
    })
    criadas++
  }
  console.log(`Conversas de demonstração: ${criadas} criada(s).`)
}

type SeedEvent = {
  dia: number
  hora: string
  dur: string
  titulo: string
  cliente: string
  origem: 'IA' | 'GOOGLE' | 'MANUAL'
}

// Agenda fictícia da spec 05 (seção 10). `dia` é o deslocamento (0-6) a partir da segunda-feira da semana corrente.
const SEED_EVENTS: SeedEvent[] = [
  { dia: 0, hora: '09:30', dur: '30 min', titulo: 'Retirada · bolo 2 kg', cliente: 'Juliana Freitas', origem: 'IA' },
  { dia: 0, hora: '11:00', dur: '1 h', titulo: 'Degustação de casamento', cliente: 'Paulo Henrique', origem: 'GOOGLE' },
  { dia: 0, hora: '15:00', dur: '30 min', titulo: 'Entrega · kit festa', cliente: 'Marcos Tavares', origem: 'MANUAL' },
  { dia: 1, hora: '10:00', dur: '1 h', titulo: 'Entrega · bolos de pote', cliente: 'Ana Paula Ribeiro', origem: 'IA' },
  { dia: 1, hora: '14:00', dur: '30 min', titulo: 'Retirada · ninho com morango', cliente: 'Carlos Menezes', origem: 'IA' },
  { dia: 3, hora: '09:00', dur: '1 h', titulo: 'Fornecedor · Laticínios Serra', cliente: 'Compromisso interno', origem: 'GOOGLE' },
  { dia: 5, hora: '16:00', dur: '1 h', titulo: 'Degustação · kit festa', cliente: 'Lívia Martins', origem: 'IA' },
]

function parseDuracao(dur: string): number {
  const n = parseInt(dur, 10)
  return dur.includes('h') ? n * 60 : n
}

// Idempotente: pula eventos cujo título já existe no workspace.
async function seedEvents(workspaceId: string) {
  const monday = new Date()
  const day = monday.getDay()
  const daysBack = day === 1 ? 0 : day === 0 ? 6 : day - 1
  monday.setDate(monday.getDate() - daysBack)
  monday.setHours(0, 0, 0, 0)

  let criados = 0
  for (const ev of SEED_EVENTS) {
    const exists = await prisma.event.findFirst({ where: { workspaceId, titulo: ev.titulo }, select: { id: true } })
    if (exists) continue

    const contact = ev.cliente.startsWith('Compromisso')
      ? null
      : await prisma.contact.findFirst({ where: { workspaceId, nome: ev.cliente }, select: { id: true } })

    const [h, m] = ev.hora.split(':').map(Number)
    const inicio = new Date(monday)
    inicio.setDate(inicio.getDate() + ev.dia)
    inicio.setHours(h, m, 0, 0)

    await prisma.event.create({
      data: {
        workspaceId,
        contactId: contact?.id ?? null,
        inicio,
        duracaoMin: parseDuracao(ev.dur),
        titulo: ev.titulo,
        tipo: ev.titulo.includes('·') ? ev.titulo.split('·')[0].trim() : ev.titulo.split(' ')[0],
        origem: ev.origem,
      },
    })
    criados++
  }
  console.log(`Eventos de demonstração: ${criados} criado(s).`)
}

type SeedProfile = {
  nome: string
  tel: string
  email: string
  tags: string[]
  pedidos: number
  total: number
  desde: [number, number] // [ano, mês]
  aniv: [number, number] | null // [mês, dia]; o ano (2000) é só um placeholder
  end: string | null
  notas: string
  cadastro?: [number, number, number] // [ano, mês, dia]: contatos sem conversa (último contato = cadastro)
}

// Contatos da spec 05 (k1...k10), com os campos de demonstração.
const SEED_PROFILES: SeedProfile[] = [
  { nome: 'Ana Paula Ribeiro', tel: '+5511998124471', email: 'anapaula.r@gmail.com', tags: ['Lead'], pedidos: 0, total: 0, desde: [2026, 10], aniv: [3, 14], end: 'Rua Itapura, 820 · Tatuapé', notas: 'Festa de 40 pessoas no dia 18.' },
  { nome: 'Carlos Menezes', tel: '+5511982205567', email: 'carlos.menezes@outlook.com', tags: ['Lead'], pedidos: 0, total: 0, desde: [2026, 10], aniv: null, end: null, notas: '' },
  { nome: 'Juliana Freitas', tel: '+5511977442210', email: 'ju.freitas@gmail.com', tags: ['Cliente'], pedidos: 6, total: 1140, desde: [2025, 3], aniv: [10, 22], end: 'Rua Tuiuti, 1430 · Tatuapé', notas: 'Prefere entrega de manhã. Gosta de ninho com morango.' },
  { nome: 'Fernanda Lopes', tel: '+5511966338812', email: 'fe.lopes@gmail.com', tags: ['Cliente'], pedidos: 2, total: 320, desde: [2026, 7], aniv: [10, 5], end: 'Av. Celso Garcia, 4100 · Belém', notas: 'Sempre paga no Pix.' },
  { nome: 'Rodrigo Alves', tel: '+5511970014410', email: 'rodrigo.alves@empresa.com', tags: ['Cliente', 'VIP'], pedidos: 14, total: 3860, desde: [2024, 11], aniv: [1, 30], end: 'Rua Azevedo Soares, 210 · Tatuapé', notas: 'Encomenda bolos para a empresa todo mês.' },
  { nome: 'Beatriz Sousa', tel: '+5511981107742', email: 'bia.sousa@gmail.com', tags: ['Lead'], pedidos: 0, total: 0, desde: [2026, 10], aniv: null, end: null, notas: 'Chegou pelo Instagram.' },
  { nome: 'Marcos Tavares', tel: '+5511984552093', email: 'marcos.tavares@gmail.com', tags: ['Cliente'], pedidos: 4, total: 780, desde: [2026, 1], aniv: [10, 11], end: 'Rua Serra de Bragança, 55 · Vila Gomes Cardim', notas: '' },
  { nome: 'Paulo Henrique', tel: '+5511993001172', email: 'paulo.h@gmail.com', tags: ['Lead', 'Casamento'], pedidos: 0, total: 0, desde: [2026, 9], aniv: null, end: null, notas: 'Casamento em dezembro, 180 convidados. Degustação marcada.', cadastro: [2026, 9, 29] },
  { nome: 'Lívia Martins', tel: '+5511975206634', email: 'livia.martins@gmail.com', tags: ['Cliente'], pedidos: 1, total: 260, desde: [2026, 8], aniv: [10, 19], end: 'Rua Apucarana, 300 · Tatuapé', notas: '', cadastro: [2026, 9, 27] },
  { nome: 'Tiago Rocha', tel: '+5511960118890', email: 'tiago.rocha@gmail.com', tags: ['Lead'], pedidos: 0, total: 0, desde: [2026, 9], aniv: null, end: null, notas: 'Pediu cardápio.', cadastro: [2026, 9, 20] },
]

function profileFields(p: SeedProfile) {
  return {
    email: p.email,
    tags: p.tags,
    endereco: p.end,
    aniversario: p.aniv ? new Date(Date.UTC(2000, p.aniv[0] - 1, p.aniv[1], 12)) : null,
    notas: p.notas || null,
    pedidos: p.pedidos,
    totalGasto: p.total,
    clienteDesde: new Date(Date.UTC(p.desde[0], p.desde[1] - 1, 1, 12)),
  }
}

// Idempotente: cria o que falta (por telefone) e só preenche contatos ainda sem dados de demonstração,
// para não sobrescrever edições feitas pela UI.
async function seedContacts(workspaceId: string) {
  let tocados = 0
  for (const p of SEED_PROFILES) {
    const where = { workspaceId_telefone: { workspaceId, telefone: p.tel } }
    const existing = await prisma.contact.findUnique({ where, select: { email: true, tags: true } })
    if (existing && (existing.email !== null || existing.tags.length > 0)) continue
    const fields = profileFields(p)
    const createdAt = p.cadastro ? new Date(p.cadastro[0], p.cadastro[1] - 1, p.cadastro[2], 10, 0) : undefined
    await prisma.contact.upsert({
      where,
      update: fields,
      create: { workspaceId, nome: p.nome, telefone: p.tel, ...fields, ...(createdAt ? { createdAt } : {}) },
    })
    tocados++
  }
  console.log(`Contatos de demonstração: ${tocados} criado(s)/completado(s).`)
}

// ---- Drawers (agente de IA, follow-up, disparos, avisos): spec 05 ----
const SEED_AGENT_PROMPT =
  'Você é a Luna, atendente virtual da Doce Ateliê, uma confeitaria artesanal na zona leste de São Paulo. Responda de forma calorosa e objetiva, em até 3 frases. Antes de fechar uma encomenda, confirme sabor, tamanho e data. Não ofereça descontos; se o cliente pedir, passe a conversa para a Mariana.'
const SEED_KB = [
  { pergunta: 'Qual o prazo para encomendas?', resposta: '48 horas para bolos e 24 horas para doces.' },
  { pergunta: 'Vocês entregam?', resposta: 'Sim, em toda a zona leste. Taxa de R$ 12 até 8 km.' },
  { pergunta: 'Formas de pagamento', resposta: 'Pix, cartão de crédito e débito. Sinal de 50% para encomendas.' },
]
const SEED_FU_MSGS = [
  'Oi, {primeiro_nome}! Conseguiu ver minha última mensagem? Fico à disposição para fechar seu pedido.',
  'Passando para saber se ainda tem interesse. Se preferir, posso te ligar.',
  'Último lembrete: ainda dá tempo de encomendar para esta semana.',
]
// Modelos da spec 05; só troca o texto dos modelos que ainda têm o texto antigo do seed.
const SEED_TEMPLATES = [
  { name: 'promo_fim_de_semana', old: 'Oi {{1}}! Neste fim de semana temos condições especiais nas encomendas. Quer saber mais?', body: 'Oi, {{1}}! Neste fim de semana o bolo de pote de ninho com morango sai por R$ 8. Quer garantir o seu?' },
  { name: 'sabor_do_mes', old: 'Oi {{1}}! O sabor do mês chegou: {{2}}. Faça sua encomenda por aqui.', body: 'Oi, {{1}}! Chegou o sabor do mês: pistache com frutas vermelhas. Responda QUERO para reservar o seu.' },
  { name: 'cupom_aniversario', old: 'Parabéns, {{1}}! Preparamos um cupom de aniversário para você: {{2}}.', body: 'Feliz aniversário, {{1}}! Você ganhou 10% de desconto em qualquer bolo até o fim do mês.' },
  { name: 'retomada_conversa', old: 'Oi {{1}}, continuamos de onde paramos? Podemos finalizar o seu pedido.', body: 'Oi, {{1}}! Ficou alguma dúvida sobre seu pedido? É só responder esta mensagem.' },
]

// Idempotente: só preenche o que ainda está vazio ou com o texto antigo do seed, para não sobrescrever edições feitas pela UI.
async function seedDrawers(workspaceId: string) {
  const agent = await prisma.aiAgent.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} })
  if (!agent.prompt.trim() || agent.prompt.startsWith('Você atende clientes da Doce Ateliê')) {
    await prisma.aiAgent.update({
      where: { id: agent.id },
      data: {
        nome: 'Luna',
        tom: 'amigavel',
        horario: 'sempre',
        prompt: SEED_AGENT_PROMPT,
        handoffRules: ['Pedido de desconto', 'Cliente pede um atendente'],
      },
    })
  }

  let kbCriados = 0
  for (const k of SEED_KB) {
    const exists = await prisma.knowledgeItem.findFirst({ where: { agentId: agent.id, pergunta: k.pergunta }, select: { id: true } })
    if (exists) continue
    await prisma.knowledgeItem.create({ data: { agentId: agent.id, ...k } })
    kbCriados++
  }

  const rule = await prisma.followUpRule.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} })
  if (rule.mensagens.length < 3) {
    await prisma.followUpRule.update({
      where: { id: rule.id },
      data: { esperaHoras: 24, tentativas: 2, mensagens: SEED_FU_MSGS, stopConditions: ['Cliente respondeu', 'Pedido fechado'] },
    })
  }

  for (const t of SEED_TEMPLATES) {
    await prisma.template.updateMany({ where: { workspaceId, name: t.name, body: t.old }, data: { body: t.body } })
  }

  // Histórico de campanhas: "Dia das Crianças" (01/10, 10:00), concluída. Sem fila de destinatários (é histórico).
  const quando = new Date(2026, 9, 1, 10, 0, 0)
  const camp = await prisma.campaign.findFirst({ where: { workspaceId, lista: 'clientes', createdAt: quando }, select: { id: true } })
  if (!camp) {
    await prisma.campaign.create({
      data: {
        workspaceId,
        lista: 'clientes',
        mensagem: 'Oi, {primeiro_nome}! Neste Dia das Crianças, o bolo de pote de ninho com morango sai por R$ 8. Quer garantir o seu?',
        scheduledAt: quando,
        intervaloMin: 15,
        intervaloMax: 30,
        intervaloFaixa: '15-30',
        status: 'concluida',
        total: 312,
        enviadas: 312,
        respostas: 41,
        createdAt: quando,
      },
    })
  }

  // Avisos padrão do usuário de demonstração (só se nunca configurou).
  await prisma.user.updateMany({
    where: { workspaceId, notifs: { isEmpty: true } },
    data: { notifs: ['Conversa sem resposta há 10 min', 'IA passou uma conversa para mim', 'Disparo concluído'] },
  })
  console.log(`Drawers de demonstração: ${kbCriados} resposta(s) criada(s); agente, follow-up e histórico garantidos.`)
}

async function main() {
  const email = 'mariana@doceatelie.com.br'
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log('Usuária do seed já existe; garantindo conversas de demonstração.')
    await seedConversations(existing.workspaceId)
    await seedContacts(existing.workspaceId)
    await seedEvents(existing.workspaceId)
    await seedDrawers(existing.workspaceId)
    return
  }

  const passwordHash = await bcrypt.hash('pearchat123', 10)
  const workspace = await prisma.workspace.create({
    data: {
      nome: 'Doce Ateliê',
      horarioAtendimento: 'Seg a Sáb, 9h às 18h',
      users: { create: { nome: 'Mariana Costa', email, passwordHash, papel: 'owner' } },
      aiAgent: {
        create: {
          enabled: false, // liga pelo menu depois de conectar o WhatsApp (o layout só mostra IA ligada com o WhatsApp conectado)
          nome: 'Luna',
          tom: 'amigavel',
          prompt: 'Você atende clientes da Doce Ateliê, uma confeitaria artesanal. Fale apenas sobre o negócio.',
          horario: 'sempre',
          handoffRules: ['Cliente pede para falar com uma pessoa', 'Reclamação ou problema com pedido'],
          canSchedule: false,
        },
      },
      followUpRule: {
        create: {
          enabled: false,
          esperaHoras: 6,
          tentativas: 2,
          mensagens: [
            'Oi! Ainda posso ajudar com o seu pedido?',
            'Passando para saber se ficou alguma dúvida. Estamos por aqui!',
          ],
          stopConditions: ['Cliente respondeu', 'Cliente pediu para parar'],
        },
      },
      templates: {
        create: [
          {
            name: 'promo_fim_de_semana',
            category: 'MARKETING',
            status: 'APROVADO',
            body: 'Oi {{1}}! Neste fim de semana temos condições especiais nas encomendas. Quer saber mais?',
          },
          {
            name: 'sabor_do_mes',
            category: 'MARKETING',
            status: 'APROVADO',
            body: 'Oi {{1}}! O sabor do mês chegou: {{2}}. Faça sua encomenda por aqui.',
          },
          {
            name: 'cupom_aniversario',
            category: 'MARKETING',
            status: 'EM_ANALISE',
            body: 'Parabéns, {{1}}! Preparamos um cupom de aniversário para você: {{2}}.',
          },
          {
            name: 'retomada_conversa',
            category: 'UTILIDADE',
            status: 'APROVADO',
            body: 'Oi {{1}}, continuamos de onde paramos? Podemos finalizar o seu pedido.',
          },
        ],
      },
    },
  })
  await seedConversations(workspace.id)
  await seedContacts(workspace.id)
  await seedEvents(workspace.id)
  await seedDrawers(workspace.id)
  console.log(`Seed criado: workspace ${workspace.id} (Doce Ateliê), login ${email} / pearchat123`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
