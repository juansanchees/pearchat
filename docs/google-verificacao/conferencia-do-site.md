# Conferência do site contra os requisitos do Google

Data: 05/10/2026. Método: GET anônimo (sem login, sem cookie) em https://pearchat.online/, /privacidade e /termos, mais leitura do código (`src/`). A conferência original não alterou nada no site; os itens da seção 2 foram corrigidos depois no código (ver o quadro abaixo). Falta apenas publicar (deploy) a versão nova.

Requisitos conferidos (todas as fontes são oficiais do Google):
- Marca: https://support.google.com/cloud/answer/13464321 e https://support.google.com/cloud/answer/15549049
- Política de Dados do Usuário (uso limitado, avisos dentro do produto): https://developers.google.com/terms/api-services-user-data-policy
- Botão do Google: https://developers.google.com/identity/branding-guidelines

## 0. Situação dos itens da seção 2 (atualizado em 05/10/2026)

Os itens 1 a 6 foram corrigidos no código da branch de trabalho. Ficam valendo depois do deploy; o item 8 e as pendências da seção 3 continuam do dono.

| Item | Situação | O que foi feito |
|---|---|---|
| 1. Aviso de privacidade no app | RESOLVIDO | Tela "Conecte sua agenda" tem um aviso antes do botão (o que acessa e para quê, o que não faz, que dá para desconectar) e link para `/privacidade#google` (`src/components/agenda/connect-flow.tsx`) |
| 2. Botões do Google fora da marca | RESOLVIDO | "G" oficial colorido em SVG; botão claro das diretrizes (fundo branco, traço `#747775`, texto `#1F1F1F`, Roboto Medium 14); textos "Continuar com o Google" e "Cadastrar-se com o Google"; o cartão "Google Agenda" usa o mesmo "G" (`src/components/brand/google-g.tsx`, `src/components/auth/fields.tsx`) |
| 3. Política genérica demais | RESOLVIDO | Seção "Uso de dados do Google" reescrita: dados lidos, o que é guardado e por quanto tempo, o que a IA recebe, quem pode ver, desconectar/revogar/excluir, escopos novos e declaração de Uso Limitado em inglês. Seções de compartilhamento e retenção ajustadas. Data: 5 de outubro de 2026 |
| 4. Home pouco explícita | RESOLVIDO | Nova dúvida frequente "Como o PearChat usa o meu Google Agenda?", com link para `/privacidade#google` (`src/components/site/sections/faq.tsx`) |
| 5. Permissões parciais | RESOLVIDO | O callback lê os escopos concedidos. Sem as três permissões, não conecta, não grava nada e a Agenda avisa "Faltou liberar uma permissão" (`erro=permissao`) |
| 6. Só em português | MITIGADO | A frase de Uso Limitado agora aparece também em inglês na política. Não há exigência oficial de página em inglês |
| 7 a 9 (baixa) | SEM MUDANÇA | Não afetam a verificação |

Escopos: o app agora pede `calendar.events`, `calendar.calendarlist.readonly` e `calendar.freebusy` (saiu o `calendar.readonly`). Contas já conectadas continuam funcionando sem reconectar.

## 1. O que está certo (verificado)

| Requisito | Resultado | Evidência |
|---|---|---|
| Página inicial pública, sem login | OK | `/` responde 200 (363 KB), sem redirecionar ao login, igual com User-Agent de Googlebot. Texto completo já vem no HTML. |
| Descreve o app (não é só login) | OK | Título "PearChat · Seu WhatsApp trabalhando por você", meta description, H1, seções Funcionalidades, Como funciona, Planos, Dúvidas; cita "Google Agenda: conecte a sua conta e veja os compromissos na mesma agenda". |
| Link visível para a privacidade na página inicial | OK | Rodapé e FAQ: `/privacidade` ("Política de privacidade"); também `/termos`. |
| Mesmo domínio | OK | Home, privacidade e termos em `pearchat.online`; `http` redireciona (308) e `www` redireciona (301) para `https://pearchat.online`. |
| Link da privacidade igual ao da tela de consentimento | OK, se usar `https://pearchat.online/privacidade` nos dois | O link da home é `/privacidade` (resolve para esse endereço). |
| Política pública e com dados do Google | OK | `/privacidade` 200 (50 KB). Seção 9 "Uso de dados do Google" (`#google`): os dois escopos, finalidades, não vende, sem publicidade, sem treinar IA generalizada, tokens criptografados, declaração de Uso Limitado com link para a política do Google, como revogar. Seção 6: retenção e exclusão (pedido por e-mail; ao desconectar os acessos são removidos). |
| Termos | OK | `/termos` 200, linkado no rodapé. |
| Nome do app igual ao do site | OK | "PearChat" no título, `og:site_name`, logo do cabeçalho (alt) e JSON-LD. Use exatamente `PearChat` na tela de consentimento. |
| Logo | OK | `src/app/icon.png` e `public/brand/pearchat-avatar-512.png`: PNG, quadrado, 512x512, menos de 100 KB (limite do Google: PNG/JPG/BMP, até 1 MB, quadrado; recomendado 120x120). |
| Rastreamento | OK | `robots.txt` permite `/`, `/privacidade`, `/termos`; `sitemap.xml` lista as 3. |
| DNS | Pronto para o TXT | Servidores de nomes `ns37/ns38.domaincontrol.com` (GoDaddy); não há registro TXT hoje na raiz, então não há conflito. |

## 2. O que falta ou pode gerar recusa (em ordem de prioridade)

### Alta (corrigir antes de enviar) - RESOLVIDO, ver quadro da seção 0

1. Sem aviso de privacidade dentro do app, no momento de conectar o Google Agenda.
   - Regra: a política do Google exige avisos no produto "bem visíveis, no momento certo e em contexto"; a página de marca repete "in-product privacy notifications must be prominently displayed".
   - Hoje: nenhum link para a privacidade em `src/components/agenda/**`; os links existem só nos formulários de login/registro/convite e no rodapé do site.
   - Correção: em `src/components/agenda/connect-flow.tsx` (cartão "Conecte sua agenda", abaixo do botão Google) e perto de "Desconectar" em `preferences.tsx`, um texto curto e um link para `/privacidade#google`. Texto sugerido: "Ao conectar, o PearChat vê as suas agendas e eventos para mostrar sua agenda, evitar conflitos de horário e criar, atualizar e apagar os agendamentos feitos por ele. Esses dados só são usados para isso. Veja a Política de Privacidade. Você pode desconectar quando quiser."

2. Botões do Google fora da marca.
   - Regra: o botão de entrar com Google deve usar o "G" colorido padrão ("Don't use monochrome versions of the Google G"); a página do Google diz que seguir isso é obrigatório para a verificação. A página de requisitos também cobre o botão que inicia a autorização.
   - Hoje: `src/components/auth/fields.tsx` (linhas 188 e 223, botão "Continuar com Google") e `src/components/agenda/connect-flow.tsx` (linhas 116 e 220, cartão "Google Agenda") usam o ícone `GoogleLogo` da Phosphor, monocromático, em cor do tema.
   - Correção: usar o SVG oficial do "G" colorido (baixar do kit de marca do Google) sobre fundo branco, borda 1 px `#747775`, texto `#1F1F1F`, mantendo "Continuar com Google" (traduzir é permitido). No cartão da Agenda, usar o mesmo "G" colorido ou nenhum logo do Google.

3. A seção "Uso de dados do Google" da política é genérica demais para dados sensíveis.
   - Regra: a política deve dizer como o app acessa, usa, guarda e compartilha os dados do Google, e o uso deve ficar limitado ao que está escrito (o Google lê "usamos apenas para..." com rigor).
   - Falta dizer (tudo verdadeiro no código): (a) quais dados: lista de agendas (nome, cor, permissão), eventos das agendas marcadas (título, início, fim, dia inteiro) e intervalos ocupados; (b) o que fica guardado: tokens criptografados (AES-256-GCM), lista de agendas e seleção, e-mail da conta, ids dos eventos criados pelo PearChat; os demais eventos do Google não são gravados, ficam só em memória por até 45 s; (c) a IA (quando o dono liga "IA pode agendar") recebe só horários livres, nunca títulos nem detalhes; (d) pessoas da equipe não leem os eventos, salvo com autorização, por segurança, por lei ou em dados agregados; (e) ao desconectar, revogamos o acesso no Google e apagamos tokens, lista de agendas e vínculos; os eventos já criados continuam na agenda do usuário.
   - Correção: acrescentar esses cinco pontos em `src/app/(legal)/privacidade/page.tsx`, seção `google`, e a frase em inglês: "PearChat's use and transfer to any other app of information received from Google APIs will adhere to Google API Services User Data Policy, including the Limited Use requirements." (o FAQ do Google aceita essa frase como declaração pública). Atualizar a data em `src/components/legal/legal-layout.tsx`. O comentário no topo do arquivo pede revisão de advogado.
   - A seção 4 também deve citar que, com a IA ligada, o provedor de IA recebe os horários livres.

### Média

4. Página inicial pouco explícita sobre o uso do Google Agenda.
   - A home cita o Google Agenda só numa frase e num exemplo visual. Atende ao requisito (descreve o app e linka a privacidade), mas o revisor pode pedir mais.
   - Correção opcional: item no FAQ ("O PearChat usa meus dados do Google Agenda?") em `src/components/site/sections/faq.tsx`, com a mesma frase de Uso Limitado e o link para `/privacidade#google`.

5. Permissões parciais: o callback ignora quais escopos o usuário realmente aceitou.
   - A tela do Google permite desmarcar caixas. `src/app/api/calendar/google/callback/route.ts` e `exchangeCode` não leem o campo `scope` da resposta, então uma conexão sem `calendar.events` seria gravada e falharia depois (403). O Console avisa isso em "Project Checkup" (permissões granulares) e revisores às vezes testam.
   - Correção: ler `scope` da resposta do token; se faltar escopo, redirecionar para `/agenda?erro=...` com mensagem clara.

6. Idioma: home, política e termos estão só em português. Não achei exigência oficial de inglês, e o revisor pode usar tradução; a frase em inglês do item 3 reduz o risco.

### Baixa

7. `robots.txt` bloqueia `/a/` (página pública de agendamento) e `/agenda`. Não afeta a verificação (o revisor usa navegador), mas não use endereços `/a/...` como "links de documentação".
8. Logo: o Console recomenda 120x120; 512x512 é aceito. Se recusar, reduzir uma cópia.
9. Fora do escopo da verificação: as páginas públicas enviam `Set-Cookie` (`__Host-authjs.csrf-token`, `__Secure-authjs.callback-url`) junto com `Cache-Control: s-maxage=31536000`. Hoje só passa pelo Caddy; se um dia entrar CDN ou cache compartilhado na frente, convém não cachear respostas com `Set-Cookie`.

## 3. Pendências fora do site (dono ou Console)

- Domínio `pearchat.online` ainda não verificado no Search Console (passo 1 do `passo-a-passo.md`). O Google exige para marca e escopos sensíveis.
- Cliente OAuth: o Google pede que o vídeo cubra todos os clientes do projeto e recomenda remover os que não são de produção. O login "Continuar com Google" usa o MESMO cliente da Agenda (`src/lib/google-login.ts`). Conferir em "Clientes" se existe outro cliente e se há endereços de redirecionamento `http://localhost` (o Console pode esconder escopos quando há URLs não HTTPS; separar um projeto de desenvolvimento resolve).
- Endereços de redirecionamento esperados no cliente de produção: `https://pearchat.online/api/calendar/google/callback` (Agenda) e `https://pearchat.online/api/auth/callback/google` (login). Confirmar no Console; não foi possível ver de fora.
- Escopos no código (`src/server/calendar/google.ts`): agora `calendar.events`, `calendar.calendarlist.readonly` e `calendar.freebusy`; o login pede só `openid email profile`. O Console precisa listar exatamente o que o código pede, senão aparece a tela de aviso mesmo após aprovar: ver o passo 3 do `passo-a-passo.md` (adicionar os dois novos e remover `calendar.readonly`).
