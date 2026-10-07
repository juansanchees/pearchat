# 04 - Drawers (painel lateral direito)

Fonte: HTML linhas 787-1268 e `renderVals()`. Tema CLARO (o drawer é filho de `<main>`). CSS do overlay/painel/cabeçalho/corpo/rodapé está literal em `00-estilos-globais.md` seção 8.

Estado: `drawer` = `null | 'ia' | 'disparos' | 'followup' | 'config' | 'plano' | 'agenda'`. `drawerOpen = !!drawer`.

## 1. Estrutura comum

- Overlay: clique fecha (`drawer=null`). Esc em qualquer momento também fecha (listener `keydown` em `window`).
- Painel: `width:min(540px, 94vw)`, `position:fixed` à direita, anima com `zfDrawer .28s ease`.
- **Cabeçalho** (`padding:18px 22px`, `gap:13px`): ícone 40×40 | bloco título+descrição (`flex:1`) | [pílula "Bloqueado" OU switch 42×24] | botão ✕.
  - Se `df.locked`: pílula tracejada `Bloqueado` (ícone `ph-lock-simple`).
  - Se `df.showToggle`: switch 42×24 (`aria-label="Ligar ou desligar"`), clique chama `df.toggle` (o mesmo de `toggleIa/Disp/Fu`).
  - `df.locked = !connected` apenas para IA, Disparos e Follow-up. Config e Plano nunca têm switch nem bloqueio.
  - Botão ✕ (`btn btn-ghost btn-icon`, 34×34, `ph ph-x` 16px) chama `fecharDrawer`.
- **Corpo** (`padding:22px; gap:24px; overflow-y:auto`).
- **Faixa "Bloqueado"** (primeiro item do corpo, só se `df.locked`): `display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:var(--radius-md); border:1px solid var(--color-accent-700); background:var(--color-accent-900)`; ícone `ph ph-lock-simple` 17px `accent-300`; texto `font-size:12.5px; color:var(--color-accent-200)`:
  > Você pode configurar tudo agora. Para ligar, conecte o WhatsApp.

  Botão `class="btn btn-primary" style="font-size:12px; padding:5px 11px; white-space:nowrap"`: `Conectar`. Clique: `view='whatsapp'`, `drawer=null` (leva à tela de conexão).
- **Rodapé** (`padding:14px 22px; border-top; display:flex; gap:10px; justify-content:flex-end; align-items:center`) por drawer:

| Drawer | Rodapé |
|---|---|
| IA, Follow-up, Config, Agenda | `Fechar` (`btn btn-ghost`, só fecha) + `Salvar` (`btn btn-primary`, ícone `ph ph-check`) |
| Disparos | texto-resumo `flex:1; font-size:12px; color:var(--color-neutral-500)` + botão principal (sem Fechar/Salvar) |
| Plano | apenas `Fechar` (`btn btn-ghost`) |

  (`showSalvar = drawer !== 'disparos' && drawer !== 'plano'`.)
  `Salvar` (`salvar`): `drawer=null` e toast `Configurações salvas` / `{df.titulo}` (ícone `ph-check-circle`), ex.: `Agentes de IA`. **Os campos são gravados em tempo real no estado a cada alteração**: Salvar e Fechar não confirmam nem descartam nada (Fechar não reverte).

- Cabeçalho por drawer (título / descrição / ícone):

| Drawer | Título | Descrição | Ícone |
|---|---|---|---|
| ia | `Agentes de IA` | `Responde seus clientes com as suas instruções` | `ph-sparkle` |
| disparos | `Disparos automáticos` | `Envie mensagens para contatos e listas` | `ph-paper-plane-tilt` |
| followup | `Follow-up automático` | `Retoma conversas de quem parou de responder` | `ph-clock-clockwise` |
| config | `Configurações` | `Perfil, empresa, avisos e conexões` | `ph-gear-six` |
| plano | `Plano e pagamento` | `Uso do mês, troca de plano e faturas` | `ph-crown-simple` |
| agenda | `Agenda` | gOn ? (agIa ? `A IA pode marcar horários livres` : `Só você marca horários`) : `Google Agenda não conectado` | `ph-calendar-dots` |

- Estilos recorrentes dentro dos drawers:
  - Rótulo de seção: `font:500 11px/1 var(--font-heading); letter-spacing:.12em; text-transform:uppercase; color:var(--color-neutral-500)`.
  - Seção: `display:flex; flex-direction:column; gap:10px` (ou 12px nas com campos).
  - Caixa de destaque (info): `padding:10px 12px (ou 12px 14px); border-radius:var(--radius-md); background:var(--color-bg); border:1px solid var(--color-divider); font-size:12px; line-height:1.45; color:var(--color-neutral-400)`.

---

## 2. Drawer "Agentes de IA" (`drawer='ia'`)

Seções na ordem:

### 2.1 Identidade
- Rótulo `Identidade`.
- Linha `display:flex; gap:12px; flex-wrap:wrap`:
  - `field` `flex:1 1 160px`: label `Nome do agente`, `<input class="input">` valor `agente.nome` (padrão `Luna`).
  - `field` `flex:1 1 220px`: label `Tom de voz`, segmentado (`.seg` com 3 botões): `Amigável` | `Profissional` | `Direto` (padrão `Amigável`).
- Qualquer alteração de qualquer campo do agente (`nome`, `tom`, `horario`, `prompt`) executa `setAg` que também zera `testA` (a resposta do teste some).
- O nome alimenta toasts, chip da barra, rótulo "Luna · IA", prévias etc.

### 2.2 Instruções
- Rótulo `Instruções`.
- Texto de apoio (`font-size:12px; color:var(--color-neutral-400)`): `Explique quem é o agente, como ele fala e o que ele pode ou não fazer.`
- Nota fixa de política (caixa de destaque, `display:flex; gap:9px`, ícone `ph ph-shield-check` 15px `accent-300`, `margin-top:1px`):
  > Por regra do WhatsApp, o agente só fala sobre o seu negócio. Assuntos fora disso recebem uma resposta educada de que ele não pode ajudar.
  Aparece sempre (não é editável nem removível).
- `<textarea class="input" rows="6" style="width:100%; resize:vertical; line-height:1.5">` valor `agente.prompt` (texto padrão em 05-dados-ficticios.md).

### 2.3 O que ele precisa saber
- Cabeçalho da seção: rótulo `O que ele precisa saber` à esquerda, contador à direita `font-size:11px; color:var(--color-neutral-500)`: `{kb.length} respostas` (sempre "respostas", ex.: `3 respostas`, também com 1).
- Itens (cada um `padding:11px 12px; border:1px solid var(--color-divider); border-radius:var(--radius-md); display:flex; gap:10px; align-items:flex-start`): pergunta `font:500 12.5px/1.3 var(--font-heading)`; resposta `font-size:12px; color:var(--color-neutral-400); margin-top:4px`; botão remover (`btn btn-ghost btn-icon` 28×28, `title="Remover"`, ícone `ph ph-trash` 14px) remove o item pelo índice, sem confirmação.
- Bloco de adicionar (tracejado): `padding:12px; border:1px dashed var(--color-neutral-700); border-radius:var(--radius-md); display:flex; flex-direction:column; gap:8px`:
  - input placeholder `Pergunta do cliente (ex: Vocês fazem bolo sem lactose?)`
  - input placeholder `Como o agente deve responder`
  - botão `btn btn-secondary` (`align-self:flex-start`) ícone `ph ph-plus`: `Adicionar resposta`. Só adiciona se ambos os campos (com `trim`) não estiverem vazios; senão não faz nada (sem toast). Ao adicionar, limpa os dois inputs e o par entra no fim da lista.

### 2.4 Passar para você quando
- Rótulo `Passar para você quando`; chips de múltipla escolha (estilo em 00): `Pedido de desconto`, `Cliente pede um atendente` (marcados por padrão), `Reclamação`, `Pedido acima de R$ 500` (desmarcados). Ordem de exibição: `Pedido de desconto`, `Reclamação`, `Cliente pede um atendente`, `Pedido acima de R$ 500`.
- No protótipo só as duas primeiras regras influenciam algo (a caixa "Testar o agente"; ver abaixo). `Reclamação` e `Pedido acima de R$ 500` não são avaliadas em lugar nenhum.

### 2.5 Quando responder
- Rótulo `Quando responder`; segmentado de 3 opções: `Sempre` (padrão) | `Fora do expediente` | `Só fins de semana`. Salva em `agente.horario`; **não é usado** em nenhuma lógica do protótipo (a descrição em Configurações referencia o horário de atendimento).

### 2.6 Testar o agente
Caixa: `padding:16px; border-radius:var(--radius-lg); background:var(--color-bg); border:1px solid var(--color-divider); display:flex; flex-direction:column; gap:10px`.
- Título `Testar o agente` (`font:500 13px/1.2 var(--font-heading)`, ícone `ph ph-flask` `accent-300`).
- Linha: `<input class="input" placeholder="Escreva como um cliente escreveria…">` + botão `btn btn-primary` `Testar`. Enter também dispara.
- Resposta (se `testA`): bolha `align-self:flex-end; max-width:88%; padding:9px 13px; border-radius:14px 14px 4px 14px; background:var(--color-accent-900); border:1px solid var(--color-accent-700)`; rótulo `{nome} · IA` com ícone `ph-fill ph-sparkle`; texto `font-size:13px; line-height:1.45`.
- Lógica (`testar`): `q = testQ.toLowerCase().trim()`; vazio -> nada. Prefixo `pre` por tom: `Amigável` = `Oi! `, `Profissional` = `Olá, tudo bem? `, `Direto` = `` (vazio). A primeira condição verdadeira vence:

| # | Condição | Resposta (literal) |
|---|---|---|
| 1 | `/desconto\|mais barato\|promo/.test(q)` E `handoff` inclui `Pedido de desconto` | `Vou chamar a Mariana para falar sobre condições especiais com você. Ela responde em instantes.` (sem prefixo) |
| 2 | `/atendente\|humano\|pessoa/.test(q)` E `handoff` inclui `Cliente pede um atendente` | `Claro, já estou passando sua conversa para a Mariana.` (sem prefixo) |
| 3 | `/pre[cç]o\|valor\|quanto/.test(q)` | `pre` + `O bolo de 1 kg sai a partir de R$ 98 e o de 2 kg a partir de R$ 189. Qual sabor você prefere?` |
| 4 | `/entrega\|entregam\|frete/.test(q)` | `pre` + `Entregamos em toda a zona leste com taxa de R$ 12 até 8 km. Qual o seu bairro?` |
| 5 | `/pix\|cart[aã]o\|pagamento\|pagar/.test(q)` | `pre` + `Aceitamos Pix, crédito e débito. Para encomendas pedimos sinal de 50%.` |
| 6 | `kbHit` (primeiro item da kb cuja pergunta tem alguma palavra com mais de 4 letras presente em `q`; palavras = `p.toLowerCase().split(/\W+/)`, onde `\W` do JS é ASCII, então letras acentuadas quebram palavras) | `pre` + resposta do item (`kb.r`) |
| 7 | senão | `pre` + `Posso te ajudar com encomendas, preços, entregas e pagamento. O que você precisa?` |

  O nome "Mariana" é fixo no código (não vem de `cfg.nome`). A resposta fica em `testA` até alterar qualquer campo do agente ou reabrir o drawer pela sidebar/chip (`open` zera `testA`).

---

## 3. Drawer "Disparos automáticos" (`drawer='disparos'`)

Estado: `disp = {lista:'clientes', msg:'Oi, {primeiro_nome}! Neste fim de semana o bolo de pote de ninho com morango sai por R$ 8. Quer garantir o seu?', quando:'Agora', intervalo:'15–30 s', data:'2026-10-10T10:00'}`, `dispOn` (padrão `true`), `campanhas`, `templates`, `tplSel`.

### 3.1 Para quem enviar
- Cabeçalho: rótulo `Para quem enviar` + link `Importar lista` (ícone `ph ph-upload-simple`, `color:var(--color-accent-300); font-size:12px`) -> toast `Importar lista` / `Envie um arquivo CSV com nome e telefone` (`ph-upload-simple`).
- 4 opções de lista (radio custom, ver 00 seção 10), cada uma com nome (`font:500 13px/1.25`), descrição (`font-size:11.5px; color:neutral-500`) e quantidade à direita (`font:500 13px/1 var(--font-heading); color:var(--color-neutral-400)`; formatada pt-BR):

| id | Nome | Descrição | Qtd |
|---|---|---|---|
| `todos` | `Todos os contatos` | `Toda a agenda sincronizada do WhatsApp` | `1.248` |
| `clientes` (padrão) | `Clientes que já compraram` | `Pelo menos um pedido fechado` | `312` |
| `aniv` | `Aniversariantes de outubro` | `Data de aniversário no cadastro` | `46` |
| `frios` | `Sem conversa há 30 dias` | `Contatos para reativar` | `128` |

### 3.2 Mensagem (conexão rápida; `isRapida = provider !== 'oficial'`, inclui `provider=null` via prop de demo)
- Rótulo `Mensagem`.
- `<textarea class="input" rows="4">` com `disp.msg`.
- Linha `Inserir:` (`font-size:11.5px; color:neutral-500`) + botões `class="tag tag-outline" style="cursor:pointer; background:none"` com `{primeiro_nome}` e `{nome}`. Clique acrescenta ao fim da mensagem (com um espaço antes, se o texto ainda não termina com espaço).
- Caixa de prévia (`padding:14px; border-radius:var(--radius-md); background:var(--color-bg); border:1px solid var(--color-divider)`): legenda `Prévia para Ana Paula Ribeiro` (`font-size:11px; color:neutral-500; margin-bottom:8px`) e bolha `margin-left:auto; max-width:90%; width:fit-content; padding:9px 13px; border-radius:14px 14px 4px 14px; background:var(--color-accent-900); border:1px solid var(--color-accent-700); font-size:13px; line-height:1.45`. Texto = `msg` com `{primeiro_nome}` -> `Ana` e `{nome}` -> `Ana Paula Ribeiro`; se vazio, `Escreva a mensagem acima`.

### 3.3 Modelo aprovado (conexão oficial; `isOficial`) - substitui a seção Mensagem
- Cabeçalho: rótulo `Modelo aprovado` + link `Criar modelo` (ícone `ph ph-plus`, `accent-300`, 12px).
- Texto de apoio (`font-size:12px; color:neutral-400`): `No WhatsApp oficial, disparos usam modelos aprovados pela Meta. A aprovação costuma levar alguns minutos.`
- Lista de modelos (radio custom, alinhado ao topo, `cursor` e `opacity` conforme status): linha 1 = nome do modelo (id) em `ui-monospace, monospace` `font:500 12.5px` + tag `tag-outline` 9.5px com a categoria (`Marketing` / `Utilidade`); linha 2 = corpo (`font-size:12px; color:neutral-500`, mantém `{{1}}` literal); à direita status (`font-size:11px`, ícone `ph-fill` 12px): `Aprovado` (`ph-check-circle`, cor `accent-300`) ou `Em análise` (`ph-clock`, cor `#b0872f`).
  - Modelo aprovado: `opacity 1`, `cursor:pointer`; selecionado = radio preenchido (`tplSel`, padrão `promo_fim_de_semana`).
  - Modelo `Em análise`: `opacity .6`, `cursor:not-allowed`; clicar -> toast `Modelo em análise` / `Aguarde a aprovação da Meta para usar` (`ph-clock`) e não seleciona.
- `Criar modelo` (`criarModelo`): adiciona `{id:'novo_modelo_' + (templates.length+1), cat:'Marketing', status:'Em análise', corpo: disp.msg com {primeiro_nome} e {nome} trocados por {{1}}}` e toast `Modelo enviado para a Meta` / `{id} · em análise` (`ph-clock`). Nunca muda para Aprovado sozinho. Usa o texto do campo `disp.msg` (que fica oculto no modo oficial, mas mantém o valor).
- Prévia: legenda `Prévia para Ana Paula Ribeiro`; bolha com o corpo do modelo selecionado trocando a **primeira** ocorrência de `{{1}}` por `Ana`.
- Lista de modelos padrão em 05-dados-ficticios.md.

### 3.4 Envio
Linha `display:flex; gap:14px; flex-wrap:wrap`:
- `field` `flex:1 1 200px`, label `Quando enviar`, segmentado `Agora` (padrão) | `Agendar`.
- `field` `flex:1 1 220px`, label `Intervalo entre mensagens`, segmentado `5–10 s` | `15–30 s` (padrão) | `30–60 s` (travessão "–" U+2013).
- Se `quando==='Agendar'`: `field` com label `Data e hora` e `<input class="input" type="datetime-local">` (valor padrão `2026-10-10T10:00`).
- Nota (`font-size:11.5px; color:neutral-500; margin-top:-12px`):
  - oficial: `Cada mensagem de marketing é cobrada pela Meta conforme a tarifa do Brasil.`
  - rápida: `Intervalos maiores deixam o envio mais natural e reduzem o risco de bloqueio do número.`

### 3.5 Campanhas
- Rótulo `Campanhas`. Cada campanha (`padding:13px 14px; border:1px solid var(--color-divider); border-radius:var(--radius-md); animation:zfIn .25s ease`): nome da lista (`font:500 13px/1.25`), data/descrição (`font-size:11px; color:neutral-500`), tag de status à direita (`tag-neutral` se `Concluída`, senão `tag-accent`, 10.5px).
- Barra de progresso (6px) com `width: round(enviadas/total*100)%` (`transition:width .4s ease`).
- Linha final (`gap:16px; font-size:11.5px; color:neutral-400`): `{enviadas}/{total} enviadas` (pt-BR, ex.: `312/312 enviadas`) e `{respostas} respostas`.
- Novas campanhas entram no topo da lista.

### 3.6 Rodapé e ação `iniciarDisparo`
- Resumo: `{qtd da lista} contatos · {nome da lista}` (ex.: `312 contatos · Clientes que já compraram`).
- Botão `btn btn-primary` ícone `ph ph-paper-plane-tilt`: `Iniciar disparo` (quando `Agora`) ou `Agendar disparo` (quando `Agendar`).
- Lógica:
  - Se `disp.msg.trim()` vazio, não faz nada (sem toast; vale também no modo oficial).
  - **Agendar**: formata `dd/mm, HH:MM` a partir de `disp.data` (se data inválida usa o texto cru); `dispOn=true`; adiciona campanha `{status:'Agendada', enviadas:0, respostas:0, total:qtd, data:'Agendada para {dt}'}`; toast `Disparo agendado` / `{nome da lista} · {dt}` (`ph-calendar-check`). Nada a envia depois (não há agendador no protótipo).
  - **Agora**: `dispOn=true`; adiciona `{status:'Enviando', data:'Hoje, {HH:MM} · intervalo {intervalo}'}` (ex.: `Hoje, 14:32 · intervalo 15–30 s`); toast `Disparo iniciado` / `{qtd pt-BR} contatos · {nome da lista}` (`ph-paper-plane-tilt`). Inicia `setInterval` de **450 ms**: para cada campanha `Enviando`, se `dispOn` é false só mantém (pausa); senão `enviadas = min(total, enviadas + max(1, ceil(total/22)))`, `respostas = floor(enviadas*0.09)`, e vira `Concluída` quando `enviadas >= total`. Quando nenhuma está rodando, limpa o intervalo e toast `Disparo concluído` / `Todas as mensagens foram enviadas` (`ph-check-circle`). Iniciar outro disparo reinicia o intervalo.
- O botão funciona mesmo com WhatsApp desconectado e drawer "Bloqueado" (não há checagem de `connected`).
- Desligar o switch de Disparos (sidebar/drawer) -> `dispOn=false` -> o envio em andamento congela (não há retomada automática além de religar).

---

## 4. Drawer "Follow-up automático" (`drawer='followup'`)

Estado: `fu = {espera:'24 h', tentativas:'2', msgs:[3 textos]}`, `fuParar`, `fuFila`, `fuOn`.

1. **Bloco explicativo** (`padding:14px 16px; border-radius:var(--radius-lg); background:var(--color-accent-900); border:1px solid var(--color-accent-700); font-size:12.5px; line-height:1.5; color:var(--color-accent-200)`):
   > Quando um cliente para de responder, o PearChat manda uma mensagem de retomada no tempo que você definir. Para assim que ele responder.
2. **Aviso oficial** (só `provider==='oficial'`; caixa de destaque com ícone `ph ph-info` 15px `accent-300`):
   > Após 24 h sem resposta, o WhatsApp oficial só aceita modelos aprovados. As tentativas depois disso usam o modelo **retomada_conversa**.
   (`retomada_conversa` em negrito `<b>`.)
3. **Regras**: linha com dois campos.
   - `Se não responder em`: segmentado `2 h` | `6 h` | `24 h` (padrão `24 h`).
   - `Tentativas`: segmentado `1` | `2` (padrão) | `3`.
4. **Mensagens de retomada** (rótulo): uma linha do tempo vertical com tantas mensagens quanto `tentativas` (primeiras N de `fu.msgs`; o array guarda sempre 3 textos). Cada item: coluna com círculo numerado 24×24 (`border:1px solid accent-700; background:accent-900; color:accent-200; font:500 11px/1`) e linha vertical (`flex:1; width:1px; background:var(--color-divider); margin-top:4px`); à direita legenda (`font-size:11.5px; color:neutral-500; margin-bottom:6px`) e `<textarea class="input" rows="2">`.
   - Legenda do 1º: `Após {espera} sem resposta` (ex.: `Após 24 h sem resposta`).
   - Legenda dos demais: `Se continuar sem resposta, mais {espera} depois`.
   - Editar grava em `fu.msgs[i]`.
5. **Parar quando**: chips `Cliente respondeu` e `Pedido fechado` (marcados por padrão), `Cliente pediu para parar` (desmarcado).
6. **Próximos envios** (rótulo): fila `fuFila` (3 itens fixos); cada linha `padding:10px 12px; border:1px solid var(--color-divider); border-radius:var(--radius-md)`, avatar 30×30 com sigla (`neutral-900`, texto `accent-200`, 11px), nome (`font:500 12.5px/1.25`), linha de tentativa (`font-size:11px; neutral-500`) e à direita o horário (`font-size:11.5px; neutral-400`). Se `fuOn` é false: horário vira `Pausado` e a linha fica com `opacity .55`; se true `opacity 1` e mostra o `quando` real.
7. Rodapé: Fechar / Salvar.

Os campos `tentativas` e `espera` não alteram a fila exibida (que é estática).

---

## 5. Drawer "Configurações" (`drawer='config'`)

Sem switch/bloqueio. Rodapé: Fechar / Salvar.

### 5.1 Perfil
- Rótulo `Perfil`.
- Linha: botão-foto 56×56 (`border-radius:999px; border:1px solid var(--color-accent-700); background:var(--color-accent-800); color:var(--color-accent-200); font:500 17px/1; overflow:hidden`; mostra a foto ou as iniciais) e botão `btn btn-secondary` (12px) com ícone `ph ph-camera`: `Trocar foto`. Ambos abrem o seletor de imagem (o mesmo `input[type=file]` da sidebar). Toast ao carregar: `Foto atualizada` / `Seu perfil já mostra a nova foto` (`ph-camera`).
- Campos: `Seu nome` (`flex:1 1 180px`, valor `cfg.nome`) e `E-mail` (`flex:1 1 220px`, valor `cfg.email`).

### 5.2 Empresa
- Rótulo `Empresa`.
- Campos: `Nome da empresa` (`cfg.empresa`) e `Horário de atendimento` (`cfg.horario`).
- Texto de apoio (`font-size:11.5px; color:neutral-500; margin-top:-4px`): `A IA usa esse horário quando a opção "Fora do expediente" estiver marcada.` (o prototipo não implementa essa lógica.)

### 5.3 Me avisar quando
- Rótulo `Me avisar quando`; 4 chips: `Conversa sem resposta há 10 min`, `IA passou uma conversa para mim`, `Disparo concluído` (os 3 marcados por padrão), `Novo agendamento` (desmarcado).

### 5.4 Conexões
- Rótulo `Conexões`. Duas linhas (`display:flex; align-items:center; gap:12px; padding:12px 14px; border:1px solid var(--color-divider); border-radius:var(--radius-md)`):
  - **WhatsApp** (ícone `ph-whatsapp-logo` 18px `accent-300`): título `WhatsApp`, sub = `connSub` (`Escaneie o QR para começar` desconectado; `Oficial · {número}` / `Conexão rápida · +55 11 98765-4321` conectado). Botão `btn btn-ghost` 12px `Desconectar` só quando conectado (mesmo efeito do botão sair da sidebar). Quando desconectado não há botão (não há "Conectar" nem "Trocar tipo de conexão" aqui).
  - **Google Agenda** (ícone `ph-google-logo`): título `Google Agenda`, sub = `gStatus` (`Não conectado` ou o e-mail da conta, `doceatelie.sp@gmail.com` se `gConta` for nulo). Conectada: botão `Desconectar` (`btn btn-ghost`) -> `gOn=false, gStep=null` + toast `Google Agenda desconectado` / `Os agendamentos param de sincronizar` (`ph-plugs`). Desconectada: botão `Conectar` (`btn btn-secondary`) -> `view='agenda'`, `drawer=null`, `gStep='conta'` (abre direto a escolha de conta).

As edições de `cfg` refletem imediatamente na sidebar (nome, empresa, iniciais) e no card "Nuvem do {empresa}" dos contatos.

---

## 6. Drawer "Plano e pagamento" (`drawer='plano'`)

Sem switch. Rodapé: só `Fechar`.

### 6.1 Bloco "Seu plano"
`padding:16px; border-radius:var(--radius-lg); border:1px solid var(--color-accent-700); background:var(--color-accent-900); display:flex; flex-direction:column; gap:14px`.
- Linha: esquerda `Seu plano` (`font-size:11.5px; color:accent-300`) + nome do plano (`font:500 20px/1.2 var(--font-heading); margin-top:3px`, padrão `Pro`); direita (alinhado à direita) preço (`font:500 16px/1.2`, ex.: `R$ 149/mês`) e `Renova em 01/11` (`font-size:11px; color:neutral-500`; fixo).
- **Medidor Meta** (só `provider==='oficial'`): caixa `padding:12px; border-radius:var(--radius-md); background:var(--color-surface); border:1px solid var(--color-accent-700)`:
  - Linha `font-size:12px`: esquerda ícone `ph ph-meta-logo` (`accent-300`) + `Mensagens de atendimento (Meta)`; direita `{svcUsed pt-BR} de 1.000 grátis` (inicial `640 de 1.000 grátis`, `color:neutral-500`).
  - Barra 6px, `width: min(100, round(svcUsed/10))%` (inicial `64%`), trilho `neutral-900`.
  - Texto `font-size:11px; color:neutral-500; margin-top:7px`: `1.000 grátis por mês neste número. Depois disso a Meta cobra por resposta enviada, inclusive as da IA.`
  - `svcUsed` sobe 1 a cada mensagem enviada pelo usuário na conversa (só com `provider==='oficial'`). Não sobe com as respostas da IA, apesar do texto.
- **Uso do mês** (3 barras fixas; trilho `var(--color-surface)`; `font-size:12px`; esquerda rótulo, direita `neutral-500`):

| Rótulo | Texto | Largura |
|---|---|---|
| `Respostas da IA` | `1.284 de 3.000` | `43%` |
| `Disparos` | `3.912 de 10.000` | `39%` |
| `Contatos` | `1.248 de 5.000` | `25%` |

(Estes valores não mudam com o plano nem com o uso real.)

### 6.2 Planos
Rótulo `Planos`. Cada plano: `padding:14px; border-radius:var(--radius-md); border:1px solid {cur ? accent-600 : divider}; display:flex; gap:14px; align-items:center`; esquerda nome (`font:500 14px/1.2`) + preço (`font-size:12.5px; color:accent-300`) e descrição (`font-size:11.5px; color:neutral-500`); direita botão (`font-size:12px; white-space:nowrap`).

| Plano | Preço | Descrição |
|---|---|---|
| `Essencial` | `R$ 79/mês` | `1 WhatsApp, 500 respostas de IA e 1.000 disparos por mês` |
| `Pro` | `R$ 149/mês` | `1 WhatsApp, 3.000 respostas de IA, 10.000 disparos, follow-up e agenda` |
| `Negócios` | `R$ 299/mês` | `3 WhatsApps, IA e disparos ilimitados, suporte prioritário` |

Botão por plano (relativo ao atual): atual = `Plano atual` (`btn btn-ghost`, clique ignorado); plano de ranking maior (Essencial 0 < Pro 1 < Negócios 2) = `Fazer upgrade` (`btn btn-primary`); menor = `Mudar` (`btn btn-secondary`). Clique em plano diferente: `plano = nome` e toast `Plano alterado para {nome}` / `A diferença aparece na próxima fatura` (`ph-crown-simple`). Atualiza a etiqueta da sidebar, o texto do rodapé do usuário e o preço no bloco.

### 6.3 Pagamento
- Rótulo `Pagamento`.
- Linha do cartão: ícone `ph ph-credit-card` 18px `accent-300`, texto `Cartão de crédito final 4417` (`font-size:12.5px`), botão `btn btn-ghost` `Trocar` -> toast `Trocar cartão` / `Você será levado ao checkout seguro` (`ph-credit-card`).
- Faturas (lista com borda, `border-radius:var(--radius-md); overflow:hidden`; cada linha `display:flex; align-items:center; gap:12px; padding:10px 14px; border-top:1px solid var(--color-divider); font-size:12.5px`): mês | valor (`neutral-500`) | tag `Pago` (`tag-neutral`, 10px) | botão `btn btn-ghost btn-icon` 28×28 (`title="Baixar"`, ícone `ph ph-download-simple` 14px) -> toast `Fatura baixada` / `PDF salvo em Downloads` (`ph-download-simple`). Dados: `Outubro 2026` `R$ 149,00`; `Setembro 2026` `R$ 149,00`; `Agosto 2026` `R$ 79,00`.

---

## 7. Drawer "Agenda" (`drawer='agenda'`)

**Atenção: não é aberto por nenhum controle do protótipo.** O código existe (`isDrawerAgenda`, `df` para `'agenda'`), mas nenhum botão faz `drawer='agenda'`: o botão Agenda da sidebar leva à `view='agenda'`. Documentado aqui por completude; recriar só se desejado.

- Switch no cabeçalho (`showToggle:true` mesmo sem Google): clique -> se `!gOn` nada acontece; senão inverte `agIa` com toast (`IA pode agendar` / `{nome} oferece horários livres aos clientes` quando liga; `IA não agenda mais` / `Só você marca horários` quando desliga; ícone `ph-calendar-check`). Visual do switch: ligado só se `agIa && gOn`.
- Se `gOff`: bloco tracejado centralizado (`padding:28px 20px; border:1px dashed var(--color-neutral-700); border-radius:var(--radius-lg)`), ícone `ph-google-logo` 26px, título `Conecte sua conta Google`, texto `Os agendamentos feitos aqui ou pela IA aparecem direto no seu Google Agenda.`, botão `btn btn-primary` com ícone (`ph-google-logo`, ou `ph-circle-notch` se `gConectando`) e rótulo `Conectar Google Agenda` (ou `Conectando…` se `gConectando`). Clique: `view='agenda'`, `drawer=null`, `gStep='conta'`.
- Se `gOn`: faixa `Sincronizado com doceatelie.sp@gmail.com` (e-mail fixo no HTML) + `agora`; seletor dos 7 dias (grade 7 colunas, mesmo `dias` da tela Agenda, ponto sob o dia se há eventos); lista de eventos do dia (rótulo = `diaTitulo`, contador `diaCount`; vazio: `Nenhum compromisso neste dia.`); caixa `Novo agendamento` (nome, tipo, `Horários livres em {diaCurto}`, botão `Agendar {agNovoHora}`); `Duração padrão` (`30 min` | `1 h` | `2 h`); `Lembrete no WhatsApp` com chips `24 h antes` | `2 h antes` | `Na hora` e, se oficial, nota `Pelo WhatsApp oficial, o lembrete usa o modelo aprovado **lembrete_agendamento**.`.
- Detalhes dos componentes de agenda em `07-agenda-e-contatos.md`.
