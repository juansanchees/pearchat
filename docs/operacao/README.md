# Operação do PearChat: guias para o dono

Guias em português simples, com os comandos prontos, o que cada um faz e o risco. Regras gerais: faça **uma coisa por vez**, mantenha **uma sessão SSH aberta** enquanto testa outra e nunca cole senhas ou chaves em chats.

## O que fazer, em ordem de importância

| # | Ação | Onde está o passo a passo |
|---|---|---|
| 1 | Conferir o `.env.production` do **servidor** (ele agora é a fonte da verdade) e guardar uma cópia | `publicacao.md` |
| 2 | Criar o **monitor externo** (UptimeRobot) para ser avisado por e-mail quando algo cair | `monitoramento.md` |
| 3 | Guardar a **chave do backup** e a `ENCRYPTION_KEY` fora do servidor | `backup.md`, `chaves.md` |
| 4 | Ligar a **cópia externa do backup** e **testar a restauração** | `backup.md`, `../../deploy/backup/restore.md` |
| 5 | Conferir se existe a **conta de demonstração** em produção e separar o banco de desenvolvimento | `supabase.md` (itens 0 e 3) |
| 6 | **Supabase:** desligar a Data API, conferir RLS e schemas de teste | `supabase.md` (itens 1 a 3) |
| 7 | **Servidor:** SSH só por chave, firewall 22/80/443, fail2ban, atualizações automáticas | `servidor.md` |
| 8 | **Limites de gasto** e chaves separadas (OpenAI, Meta, Google, Resend, Asaas) | `chaves.md` |
| 9 | Tornar o repositório **privado** e proteger a branch principal | `repositorio.md` |
| 10 | Papéis de banco com privilégios mínimos (`pearchat_app` e `pearchat_migrator`) | `supabase.md` (item 5) |
| 11 | **E-mail:** Resend, SPF, DKIM, DMARC e CAA | `email-dominio.md` |
| 12 | Apagar as sobras do Zapfloo (depois de um backup final) | `servidor.md` (item 5) |

## Arquivos

- `publicacao.md`: publicar, voltar atrás, o que olhar depois, regra das migrações, avisos do Next 14.
- `monitoramento.md`: o monitor externo por e-mail (curto) e os alertas internos.
- `backup.md`: cópia fora do servidor e teste de restauração.
- `servidor.md`: SSH, firewall, fail2ban, atualizações, sobras do Zapfloo.
- `supabase.md`: o que conferir no painel e o SQL do papel restrito.
- `chaves.md`: onde trocar cada chave e os limites de gasto.
- `email-dominio.md`: SPF, DKIM, DMARC, CAA.
- `repositorio.md`: GitHub privado, proteção de branch, varredura de segredos.
