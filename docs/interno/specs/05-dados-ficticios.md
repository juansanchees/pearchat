# 05 - Dados fictícios iniciais (copiados do `Component`)

Negócio de exemplo: confeitaria **Doce Ateliê**, dona Mariana Costa. "Hoje" no protótipo = **sexta-feira, 2 de outubro de 2026** (a semana mostrada vai de 2 a 8 de outubro). Todos os literais abaixo são cópia fiel do HTML. Formato: TypeScript literal.

## 1. Estado inicial (flags e escalares)

```ts
const estadoInicial = {
  provider: null,                 // null | 'oficial' | 'rapida'
  ofStep: 'numero',               // 'numero' | 'qr' | 'hist'
  ofNumero: '+55 11 98765-4321',
  ofHist: true,
  svcUsed: 640,                   // mensagens de atendimento Meta usadas (de 1.000 grátis)
  tplSel: 'promo_fim_de_semana',
  connected: false,               // prop iniciarConectado (boolean, padrão false) pode forçar true no mount
  qrState: 'aguardando',          // 'aguardando' | 'conectando'
  drawer: null,
  toast: null,
  filtro: 'todas',
  busca: '',
  ativa: 'c1',
  draft: '',
  iaOn: false,
  dispOn: true,
  fuOn: false,
  plano: 'Pro',
  cfgFoto: null,
  ctBusca: '',
  ctFiltro: 'Todos',
  ctSel: 'k1',
  ctNovo: false,
  ctForm: { nome: '', tel: '', email: '', tag: 'Lead' },
  ctExtra: 1238,                  // contatos "além dos 10 listados"; total exibido = contatos.length + ctExtra = 1.248
  view: 'whatsapp',               // 'whatsapp' | 'agenda' | 'contatos'
  gStep: null,                    // null | 'conta' | 'agendas'
  gConta: null,
  gCals: ['pedidos', 'pessoal'],
  gOn: false,
  gConectando: false,
  agIa: true,
  agDia: 0,                       // índice do dia selecionado (0 = sexta 2/out)
  agDur: '1 h',
  agLembretes: ['24 h antes', '2 h antes'],
  agNovoCliente: '',
  agNovoTipo: 'Retirada de pedido',
  agNovoHora: '',
  kbP: '', kbR: '', testQ: '', testA: null,
};
```

## 2. cfg (perfil e empresa)

```ts
cfg: { nome: 'Mariana Costa', email: 'mariana@doceatelie.com.br', empresa: 'Doce Ateliê', horario: 'Seg a sáb, 8h às 18h' }
```

## 3. notifs (chips marcados em "Me avisar quando")

```ts
notifs: ['Conversa sem resposta há 10 min', 'IA passou uma conversa para mim', 'Disparo concluído']
// Opções disponíveis (ordem de exibição):
// ['Conversa sem resposta há 10 min', 'IA passou uma conversa para mim', 'Disparo concluído', 'Novo agendamento']
```

## 4. Plano

```ts
plano: 'Pro'
// planDefs
[
  { nome: 'Essencial', preco: 'R$ 79/mês',  desc: '1 WhatsApp, 500 respostas de IA e 1.000 disparos por mês' },
  { nome: 'Pro',       preco: 'R$ 149/mês', desc: '1 WhatsApp, 3.000 respostas de IA, 10.000 disparos, follow-up e agenda' },
  { nome: 'Negócios',  preco: 'R$ 299/mês', desc: '3 WhatsApps, IA e disparos ilimitados, suporte prioritário' }
]
// ranking p/ botões: { 'Essencial': 0, 'Pro': 1, 'Negócios': 2 }
// uso do mês (fixo)
[
  { label: 'Respostas da IA', txt: '1.284 de 3.000',  pct: '43%' },
  { label: 'Disparos',        txt: '3.912 de 10.000', pct: '39%' },
  { label: 'Contatos',        txt: '1.248 de 5.000',  pct: '25%' }
]
// faturas
[
  { mes: 'Outubro 2026',  valor: 'R$ 149,00' },
  { mes: 'Setembro 2026', valor: 'R$ 149,00' },
  { mes: 'Agosto 2026',   valor: 'R$ 79,00' }
]
// cartão (texto fixo): 'Cartão de crédito final 4417'
// renovação (texto fixo): 'Renova em 01/11'
```

## 5. Chats

Campo `unread` = não lidas; `mode`: `null` (ninguém atendeu), `'ia'`, `'humano'`; `typing` sempre `false` no início. `from`: `'cliente' | 'eu' | 'ia'`.

```ts
chats: [
  { id: 'c1', nome: 'Ana Paula Ribeiro', sigla: 'AP', tel: '+55 11 99812-4471', unread: 2, mode: null, typing: false, msgs: [
    { from: 'cliente', texto: 'Oi! Vocês fazem bolo de pote para festa?', hora: '10:12' },
    { from: 'cliente', texto: 'Seria para umas 40 pessoas, dia 18.', hora: '10:13' }
  ] },
  { id: 'c2', nome: 'Carlos Menezes', sigla: 'CM', tel: '+55 11 98220-5567', unread: 1, mode: null, typing: false, msgs: [
    { from: 'cliente', texto: 'Boa tarde. Qual o valor do bolo de 2 kg de ninho com morango?', hora: '10:05' }
  ] },
  { id: 'c3', nome: 'Juliana Freitas', sigla: 'JF', tel: '+55 11 97744-2210', unread: 1, mode: 'ia', typing: false, msgs: [
    { from: 'cliente', texto: 'Vocês entregam no Tatuapé?', hora: '09:40' },
    { from: 'ia', texto: 'Entregamos sim, Juliana! A taxa para o Tatuapé é de R$ 12. Para qual dia você precisa?', hora: '09:40' },
    { from: 'cliente', texto: 'Perfeito, quero para sábado de manhã.', hora: '09:52' }
  ] },
  { id: 'c4', nome: 'Fernanda Lopes', sigla: 'FL', tel: '+55 11 96633-8812', unread: 1, mode: null, typing: false, msgs: [
    { from: 'cliente', texto: 'Consigo pagar no Pix?', hora: '09:31' }
  ] },
  { id: 'c5', nome: 'Rodrigo Alves', sigla: 'RA', tel: '+55 11 97001-4410', unread: 0, mode: 'humano', typing: false, msgs: [
    { from: 'eu', texto: 'Rodrigo, seu bolo saiu para entrega agora.', hora: '08:58' },
    { from: 'cliente', texto: 'Recebi! Ficou lindo, obrigado.', hora: '09:20' }
  ] },
  { id: 'c6', nome: 'Beatriz Sousa', sigla: 'BS', tel: '+55 11 98110-7742', unread: 1, mode: null, typing: false, msgs: [
    { from: 'cliente', texto: 'Oi! Vi o cardápio de vocês no Instagram.', hora: 'Ontem' }
  ] },
  { id: 'c7', nome: 'Marcos Tavares', sigla: 'MT', tel: '+55 11 98455-2093', unread: 0, mode: 'humano', typing: false, msgs: [
    { from: 'cliente', texto: 'Pode ser às 15h?', hora: 'Ontem' },
    { from: 'eu', texto: 'Pode sim. Seu pedido sai às 15h.', hora: 'Ontem' }
  ] }
]
```

Respostas fixas da IA ao ligar o agente (por id de conversa):

```ts
const REPLIES = {
  c1: 'Oi, Ana! Fazemos sim. Para 40 pessoas sugerimos 45 potes de 200 ml, nos sabores ninho com morango, brigadeiro e red velvet. Sai por R$ 9,50 cada. A festa é dia 18 de qual mês?',
  c2: 'Olá, Carlos! O bolo de 2 kg de ninho com morango custa R$ 189. Pedimos 48 horas de antecedência. Quer que eu reserve uma data?',
  c3: 'Combinado, Juliana! Sábado entre 9h e 11h. Me confirma o sabor e o tamanho do bolo?',
  c4: 'Pode sim, Fernanda! A chave Pix é o CNPJ 12.345.678/0001-90. Assim que enviar o comprovante eu confirmo seu pedido.',
  c6: 'Oi, Beatriz! Que bom que gostou. Quer que eu te envie o cardápio completo com os preços?'
};
```

## 6. Contatos

Campos: `ultimo` é texto livre ("Hoje", "Ontem", "29/09" etc.). `chat` aponta para o id da conversa (ou `null` = sem conversa).

```ts
contatos: [
  { id: 'k1', nome: 'Ana Paula Ribeiro', tel: '+55 11 99812-4471', email: 'anapaula.r@gmail.com', tags: ['Lead'], ultimo: 'Hoje', pedidos: 0, total: 'R$ 0', desde: 'out 2026', aniv: '14 de março', end: 'Rua Itapura, 820 · Tatuapé', notas: 'Festa de 40 pessoas no dia 18.', chat: 'c1' },
  { id: 'k2', nome: 'Carlos Menezes', tel: '+55 11 98220-5567', email: 'carlos.menezes@outlook.com', tags: ['Lead'], ultimo: 'Hoje', pedidos: 0, total: 'R$ 0', desde: 'out 2026', aniv: '—', end: '—', notas: '', chat: 'c2' },
  { id: 'k3', nome: 'Juliana Freitas', tel: '+55 11 97744-2210', email: 'ju.freitas@gmail.com', tags: ['Cliente'], ultimo: 'Hoje', pedidos: 6, total: 'R$ 1.140', desde: 'mar 2025', aniv: '22 de outubro', end: 'Rua Tuiuti, 1430 · Tatuapé', notas: 'Prefere entrega de manhã. Gosta de ninho com morango.', chat: 'c3' },
  { id: 'k4', nome: 'Fernanda Lopes', tel: '+55 11 96633-8812', email: 'fe.lopes@gmail.com', tags: ['Cliente'], ultimo: 'Hoje', pedidos: 2, total: 'R$ 320', desde: 'jul 2026', aniv: '5 de outubro', end: 'Av. Celso Garcia, 4100 · Belém', notas: 'Sempre paga no Pix.', chat: 'c4' },
  { id: 'k5', nome: 'Rodrigo Alves', tel: '+55 11 97001-4410', email: 'rodrigo.alves@empresa.com', tags: ['Cliente', 'VIP'], ultimo: 'Hoje', pedidos: 14, total: 'R$ 3.860', desde: 'nov 2024', aniv: '30 de janeiro', end: 'Rua Azevedo Soares, 210 · Tatuapé', notas: 'Encomenda bolos para a empresa todo mês.', chat: 'c5' },
  { id: 'k6', nome: 'Beatriz Sousa', tel: '+55 11 98110-7742', email: 'bia.sousa@gmail.com', tags: ['Lead'], ultimo: 'Ontem', pedidos: 0, total: 'R$ 0', desde: 'out 2026', aniv: '—', end: '—', notas: 'Chegou pelo Instagram.', chat: 'c6' },
  { id: 'k7', nome: 'Marcos Tavares', tel: '+55 11 98455-2093', email: 'marcos.tavares@gmail.com', tags: ['Cliente'], ultimo: 'Ontem', pedidos: 4, total: 'R$ 780', desde: 'jan 2026', aniv: '11 de outubro', end: 'Rua Serra de Bragança, 55 · Vila Gomes Cardim', notas: '', chat: 'c7' },
  { id: 'k8', nome: 'Paulo Henrique', tel: '+55 11 99300-1172', email: 'paulo.h@gmail.com', tags: ['Lead', 'Casamento'], ultimo: '29/09', pedidos: 0, total: 'R$ 0', desde: 'set 2026', aniv: '—', end: '—', notas: 'Casamento em dezembro, 180 convidados. Degustação marcada.', chat: null },
  { id: 'k9', nome: 'Lívia Martins', tel: '+55 11 97520-6634', email: 'livia.martins@gmail.com', tags: ['Cliente'], ultimo: '27/09', pedidos: 1, total: 'R$ 260', desde: 'ago 2026', aniv: '19 de outubro', end: 'Rua Apucarana, 300 · Tatuapé', notas: '', chat: null },
  { id: 'k10', nome: 'Tiago Rocha', tel: '+55 11 96011-8890', email: 'tiago.rocha@gmail.com', tags: ['Lead'], ultimo: '20/09', pedidos: 0, total: 'R$ 0', desde: 'set 2026', aniv: '—', end: '—', notas: 'Pediu cardápio.', chat: null }
]
// Filtros de contatos (contagens fixas, exceto "Todos" = total): 
// [['Todos', 1248], ['Clientes', 312], ['Leads', 540], ['VIP', 38]]
// Etiquetas do formulário "Novo contato": ['Lead', 'Cliente', 'VIP', 'Casamento'] (padrão 'Lead')
```

Siglas dos contatos são calculadas no render: 1ª letra do 1º nome + 1ª letra do 2º nome ("Ana Paula Ribeiro" -> `AP`).

## 7. Agente de IA e base de respostas

```ts
agente: {
  nome: 'Luna',
  tom: 'Amigável',            // opções: 'Amigável' | 'Profissional' | 'Direto'
  horario: 'Sempre',          // opções: 'Sempre' | 'Fora do expediente' | 'Só fins de semana'
  prompt: 'Você é a Luna, atendente virtual da Doce Ateliê, uma confeitaria artesanal na zona leste de São Paulo. Responda de forma calorosa e objetiva, em até 3 frases. Antes de fechar uma encomenda, confirme sabor, tamanho e data. Não ofereça descontos; se o cliente pedir, passe a conversa para a Mariana.'
},
handoff: ['Pedido de desconto', 'Cliente pede um atendente'],
// opções (ordem de exibição): ['Pedido de desconto', 'Reclamação', 'Cliente pede um atendente', 'Pedido acima de R$ 500']
kb: [
  { p: 'Qual o prazo para encomendas?', r: '48 horas para bolos e 24 horas para doces.' },
  { p: 'Vocês entregam?', r: 'Sim, em toda a zona leste. Taxa de R$ 12 até 8 km.' },
  { p: 'Formas de pagamento', r: 'Pix, cartão de crédito e débito. Sinal de 50% para encomendas.' }
]
```

## 8. Disparos

```ts
disp: {
  lista: 'clientes',
  msg: 'Oi, {primeiro_nome}! Neste fim de semana o bolo de pote de ninho com morango sai por R$ 8. Quer garantir o seu?',
  quando: 'Agora',               // 'Agora' | 'Agendar'
  intervalo: '15–30 s',          // '5–10 s' | '15–30 s' | '30–60 s'  (travessão en dash)
  data: '2026-10-10T10:00'
},
// listas de disparo
[
  { id: 'todos',    nome: 'Todos os contatos',          desc: 'Toda a agenda sincronizada do WhatsApp', qtd: 1248 },
  { id: 'clientes', nome: 'Clientes que já compraram',  desc: 'Pelo menos um pedido fechado',           qtd: 312 },
  { id: 'aniv',     nome: 'Aniversariantes de outubro', desc: 'Data de aniversário no cadastro',        qtd: 46 },
  { id: 'frios',    nome: 'Sem conversa há 30 dias',    desc: 'Contatos para reativar',                 qtd: 128 }
],
campanhas: [
  { id: 'cp1', lista: 'Clientes que já compraram', total: 312, enviadas: 312, respostas: 41, status: 'Concluída', data: 'Dia das Crianças · 01/10, 10:00' }
],
// variáveis da mensagem: ['{primeiro_nome}', '{nome}']  -> prévia: Ana / Ana Paula Ribeiro
```

### Modelos aprovados (provider oficial)

```ts
templates: [
  { id: 'promo_fim_de_semana', cat: 'Marketing', status: 'Aprovado',   corpo: 'Oi, {{1}}! Neste fim de semana o bolo de pote de ninho com morango sai por R$ 8. Quer garantir o seu?' },
  { id: 'sabor_do_mes',        cat: 'Marketing', status: 'Aprovado',   corpo: 'Oi, {{1}}! Chegou o sabor do mês: pistache com frutas vermelhas. Responda QUERO para reservar o seu.' },
  { id: 'cupom_aniversario',   cat: 'Marketing', status: 'Em análise', corpo: 'Feliz aniversário, {{1}}! Você ganhou 10% de desconto em qualquer bolo até o fim do mês.' },
  { id: 'retomada_conversa',   cat: 'Utilidade', status: 'Aprovado',   corpo: 'Oi, {{1}}! Ficou alguma dúvida sobre seu pedido? É só responder esta mensagem.' }
]
// também citado em textos: 'lembrete_agendamento' (modelo de lembrete da agenda; não existe na lista de templates)
```

## 9. Follow-up

```ts
fu: {
  espera: '24 h',                // '2 h' | '6 h' | '24 h'
  tentativas: '2',               // '1' | '2' | '3' (string)
  msgs: [
    'Oi, {primeiro_nome}! Conseguiu ver minha última mensagem? Fico à disposição para fechar seu pedido.',
    'Passando para saber se ainda tem interesse. Se preferir, posso te ligar.',
    'Último lembrete: ainda dá tempo de encomendar para esta semana.'
  ]
},
fuParar: ['Cliente respondeu', 'Pedido fechado'],
// opções: ['Cliente respondeu', 'Pedido fechado', 'Cliente pediu para parar']
fuFila: [
  { nome: 'Paulo Henrique', sigla: 'PH', quando: 'em 1 h 20 min',  tentativa: '1ª tentativa · orçamento de bolo de casamento' },
  { nome: 'Lívia Martins',  sigla: 'LM', quando: 'em 3 h',         tentativa: '2ª tentativa · kit festa 20 pessoas' },
  { nome: 'Tiago Rocha',    sigla: 'TR', quando: 'amanhã, 09:00',  tentativa: '1ª tentativa · pediu cardápio' }
]
```

## 10. Agenda

```ts
// dias da semana (índice 0 = hoje); número do dia = 2 + índice
const semanas = ['Sex', 'Sáb', 'Dom', 'Seg', 'Ter', 'Qua', 'Qui'];
const longos  = ['Hoje · sexta, 2 de outubro', 'Sábado, 3 de outubro', 'Domingo, 4 de outubro', 'Segunda, 5 de outubro', 'Terça, 6 de outubro', 'Quarta, 7 de outubro', 'Quinta, 8 de outubro'];
const curtos  = ['hoje', 'sáb, 3/10', 'dom, 4/10', 'seg, 5/10', 'ter, 6/10', 'qua, 7/10', 'qui, 8/10'];
// horas da grade
const horasGrade = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];
// horários livres sugeridos (menos os eventos com hora exatamente igual)
const livresBase = ['09:00','10:00','11:00','14:00','15:00','16:00','17:00'];
const tiposAg = ['Retirada de pedido', 'Entrega', 'Degustação', 'Reunião'];
const durOpts = ['30 min', '1 h', '2 h'];                   // padrão agDur = '1 h'
const lembreteOpts = ['24 h antes', '2 h antes', 'Na hora']; // padrão marcado: ['24 h antes', '2 h antes']

eventos: [
  { dia: 0, hora: '09:30', dur: '30 min', titulo: 'Retirada · bolo 2 kg',             cliente: 'Juliana Freitas',      origem: 'IA' },
  { dia: 0, hora: '11:00', dur: '1 h',    titulo: 'Degustação de casamento',          cliente: 'Paulo Henrique',       origem: 'Google' },
  { dia: 0, hora: '15:00', dur: '30 min', titulo: 'Entrega · kit festa',              cliente: 'Marcos Tavares',       origem: 'Manual' },
  { dia: 1, hora: '10:00', dur: '1 h',    titulo: 'Entrega · bolos de pote',          cliente: 'Ana Paula Ribeiro',    origem: 'IA' },
  { dia: 1, hora: '14:00', dur: '30 min', titulo: 'Retirada · ninho com morango',     cliente: 'Carlos Menezes',       origem: 'IA' },
  { dia: 3, hora: '09:00', dur: '1 h',    titulo: 'Fornecedor · Laticínios Serra',    cliente: 'Compromisso interno',  origem: 'Google' },
  { dia: 5, hora: '16:00', dur: '1 h',    titulo: 'Degustação · kit festa',           cliente: 'Lívia Martins',        origem: 'IA' }
]
```

Contas Google oferecidas e agendas:

```ts
gContas: [
  { nome: 'Doce Ateliê',    email: 'doceatelie.sp@gmail.com',   sigla: 'DA' },
  { nome: 'Mariana Costa',  email: 'mariana.costa@gmail.com',   sigla: 'MC' }
],
gCalOpts: [   // padrão marcado (gCals): ['pedidos', 'pessoal']
  { id: 'pedidos',  nome: 'Doce Ateliê · Pedidos', desc: 'Onde os novos agendamentos são criados', cor: 'var(--color-accent-500)' },
  { id: 'pessoal',  nome: 'Pessoal',               desc: 'Só para bloquear horários ocupados',     cor: '#d9a35b' },
  { id: 'feriados', nome: 'Feriados no Brasil',    desc: 'Evita agendar em feriados',              cor: '#5fa7a0' }
],
agBeneficios: [
  { icon: 'ph-whatsapp-logo', titulo: 'Agendou no WhatsApp, caiu no Google',   texto: 'Cada horário marcado numa conversa vira um evento no seu calendário.' },
  { icon: 'ph-sparkle',       titulo: 'A IA só oferece horários livres',        texto: 'O agente consulta sua agenda antes de sugerir um horário ao cliente.' },
  { icon: 'ph-bell-ringing',  titulo: 'Lembrete automático para o cliente',     texto: 'Mensagem no WhatsApp antes do compromisso, sem você precisar lembrar.' }
],
agOutras: [   // provedores "Em breve" (desabilitados)
  { nome: 'Outlook',      icon: 'ph-microsoft-outlook-logo' },
  { nome: 'Apple iCloud', icon: 'ph-apple-logo' }
]
```

## 11. Textos dos passos de conexão (dados estáticos)

```ts
ofRequisitos: [
  { icon: 'ph-device-mobile', texto: 'O número precisa estar no app WhatsApp Business, versão atualizada.' },
  { icon: 'ph-meta-logo',     texto: 'Você vai entrar com sua conta do Facebook ou Meta Business.' },
  { icon: 'ph-users-three',   texto: 'Grupos continuam só no celular. Conversas individuais aparecem aqui.' }
],
ofQrPassos: [
  { n: '1', texto: 'Abra a mensagem da Meta no WhatsApp Business e toque em Conectar à plataforma.' },
  { n: '2', texto: 'Toque em Escanear QR code.' },
  { n: '3', texto: 'Aponte a câmera para o código ao lado.' }
],
ofHistOpts: [
  [true,  'Importar conversas e contatos', 'Últimos 6 meses de conversas individuais'],
  [false, 'Começar do zero',               'Só as novas conversas aparecem aqui']
],
passos /* conexão rápida */: [
  { n: '1', texto: 'Abra o WhatsApp no celular que você usa para atender clientes.' },
  { n: '2', texto: 'Vá em Configurações e toque em Dispositivos conectados.' },
  { n: '3', texto: 'Toque em Conectar um dispositivo e aponte a câmera para o código ao lado.' }
]
```

(Os cartões de escolha do tipo de conexão estão em `02-conectar-whatsapp.md`.)

## 12. Números fixos no HTML (não vêm do estado)

| Onde | Valor |
|---|---|
| Barra superior de Conversas | `Doce Ateliê · +55 11 98765-4321` |
| Subtítulo da sidebar (conexão rápida) | `Conexão rápida · +55 11 98765-4321` |
| Toast de conexão rápida | `Doce Ateliê · +55 11 98765-4321` |
| Mini-calendário da sidebar | `OUT` / `2` |
| Grade da Agenda | `Outubro 2026` / `2 a 8 de outubro` |
| Drawer Agenda (não alcançável) | `doceatelie.sp@gmail.com` |
| Usado quando `gConta` é nulo | `doceatelie.sp@gmail.com` (em `gStatus`) |
| Nome da dona nas respostas do teste | `Mariana` |
| Prévia de disparo | `Ana` / `Ana Paula Ribeiro` |
