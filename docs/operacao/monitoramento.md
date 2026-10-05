# Monitoramento: ser avisado quando algo cair

**Em uma frase:** um serviço gratuito de fora (UptimeRobot) olha o PearChat a cada 5 minutos e **manda um e-mail para você** quando algo estiver errado e quando voltar ao normal.

Por que de fora? O monitor que roda dentro do servidor não consegue avisar ninguém se o servidor inteiro cair. O serviço externo funciona mesmo nesse caso, e **não depende do serviço de e-mail do PearChat (Resend)**.

O PearChat tem um endereço de verificação feito para isso. Ele não responde só "o site está no ar": ele também olha por dentro (banco, WhatsApp de cliente caído, fila de automações parada, mensagens falhando, backup atrasado...) e, se algo crítico estiver errado, responde com erro. O serviço externo percebe o erro e te avisa.

## Passo a passo (uns 10 minutos)

Antes: peça o **endereço de verificação** a quem publica o PearChat (ele termina com `?token=...`). **Esse endereço tem uma senha dentro dele.** Não mande em grupo, não poste em lugar nenhum.

1. Entre em **uptimerobot.com** e clique em **Register for FREE** (cadastro gratuito). Use o e-mail em que você quer receber os avisos. Confirme o e-mail que eles enviarem.
2. Dentro da conta, clique em **+ New monitor** (ou "Add New Monitor").
3. Em **Monitor Type**, escolha **HTTP(s)**.
4. Em **Friendly Name**, escreva `PearChat`.
5. Em **URL**, cole o endereço de verificação inteiro, com o `?token=...` no final.
6. Em **Monitoring Interval**, escolha **5 minutes** (é o mínimo do plano gratuito).
7. Em **Alert Contacts To Notify** (quem avisar), deixe marcado o seu e-mail.
8. Clique em **Create Monitor**.
9. Espere 1 ou 2 minutos: o monitor deve ficar **verde ("Up")**. Se ficar vermelho logo de cara, confira se copiou o endereço inteiro, sem espaço no começo ou no fim.

Pronto: é **um monitor só**. Não precisa de mais nada.

## Que e-mail você vai receber

- **Quando cair:** assunto parecido com **"Monitor is DOWN: PearChat"**, dizendo o horário e o motivo (ex.: `HTTP 503`).
- **Quando voltar:** **"Monitor is UP: PearChat"**, dizendo por quanto tempo ficou fora.
- Ele não repete o aviso a cada 5 minutos enquanto o problema durar: avisa quando cai e quando volta.

**Descobrir O QUE está errado:** abra o endereço de verificação no navegador. Se estiver tudo bem, aparece só `OK`. Se não, aparece uma linha curta, por exemplo `PROBLEMA: whatsapp_desconectado=1 fila_parada=3`. Cada palavra é um tipo de problema:

| Palavra | O que significa | O que fazer |
|---|---|---|
| `banco_fora` | o PearChat não consegue falar com o banco de dados (Supabase) | ver se o Supabase está no ar (status.supabase.com) e se a senha não foi trocada |
| `agendador_parado` | o "motor" das automações (IA, follow-up, lembretes) parou | pedir a quem publica para reiniciar o app |
| `whatsapp_desconectado=N` | N clientes que usam a IA estão com o WhatsApp caído há mais de 10 minutos | às vezes é o próprio cliente que desligou; se forem vários ao mesmo tempo, a Evolution tem problema |
| `fila_parada=N` | N tarefas de automação estão atrasadas há mais de 15 minutos | reiniciar o app; ver se a chave da IA tem crédito |
| `falhas_de_envio=N` | várias mensagens falharam e nenhuma saiu | WhatsApp/Evolution com problema |
| `ia_sem_credito=N` | a IA (OpenAI) está recusando as chamadas | ver crédito, limite de gasto e a chave no painel da OpenAI (`chaves.md`) |
| `entrada_acumulada=N` | mensagens recebidas estão se acumulando sem ser processadas | reiniciar o app |
| `backup_atrasado` | o último backup bom tem mais de 2 dias | ver `deploy/backup/restore.md` e o log do backup |

Os avisos só falam de **tipos de problema e quantidades**: nunca nome nem telefone de cliente.

> **Dica:** no UptimeRobot gratuito o e-mail mostra só "HTTP 503", não a palavra do problema. Por isso, ao receber um aviso, **abra o endereço no navegador** para ver o motivo. (O Better Stack, também gratuito, guarda o texto da resposta dentro do incidente; se preferir, use ele no lugar do UptimeRobot com os mesmos passos.)

## Se um dia trocarem o token

Se quem publica trocar o `HEALTH_TOKEN`, o endereço antigo passa a dar erro 404 e o UptimeRobot vai avisar que caiu. Peça o endereço novo e, no UptimeRobot, abra o monitor, clique em **Edit** e cole a URL nova.

## Quando você configurar o serviço de e-mail (Resend)

Hoje o Resend **não** está configurado, então o monitor que roda dentro do servidor não consegue mandar e-mail (ele continua anotando tudo no log do servidor). Quando você configurar o Resend, ele passa a mandar os avisos internos por e-mail também, **além** do UptimeRobot. O que preencher, no servidor:

1. Em `/opt/pearchat/deploy/.env.production`: `RESEND_API_KEY` (a chave do Resend) e `MAIL_FROM` (o remetente, ex.: `PearChat <nao-responda@seu-dominio>`). O passo a passo do Resend e do domínio está em `email-dominio.md`.
2. Em `/etc/pearchat-monitor.conf`: `ALERT_EMAIL_TO=seu@email.com` (mais de um e-mail: separe por vírgula).
3. Teste: `bash /opt/pearchat/deploy/monitor/check.sh --test-alert`. Deve chegar um e-mail "alerta de teste". Se não chegar, veja `/var/log/pearchat-monitor.log`: a linha diz o motivo (por exemplo, falta a chave do Resend).

O monitor interno olha mais coisas que o endereço externo (disco, certificado, contêineres reiniciando, memória, backup sem cópia externa...). Os dois se completam.

Outros canais opcionais (webhook, Telegram, ntfy) e o "batimento" (um serviço que avisa quando o próprio monitor para de rodar) estão descritos em `deploy/monitor/README.md`.
