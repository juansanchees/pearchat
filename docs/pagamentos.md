# Pagamentos (Asaas): guia do dono

O PearChat cobra assinaturas pelo **Asaas** (Pix, boleto e cartão). Tudo já está pronto no sistema e vem **desligado**:
com `BILLING_ENABLED=false` o app funciona como sempre (sem teste grátis, sem cobrança, sem restrição).

O PearChat **nunca vê nem guarda dados de cartão**. O cliente paga na página segura do Asaas (a "fatura" abre numa nova aba).
Guardamos só os códigos do Asaas, o status e as datas.

## Como funciona (resumo)

- Contas novas (só com a cobrança ligada) ganham **teste grátis de 7 dias** no plano Essencial (`TRIAL_DAYS`).
- Contas que já existem ficam **isentas**: nada muda para elas (inclusive a sua e a conta de demonstração).
- O dono da conta escolhe o plano, a forma de pagamento (Pix, boleto ou cartão) e informa o CPF/CNPJ do pagador.
  A assinatura nasce no Asaas e a conta fica **"Aguardando pagamento"** até o Asaas confirmar.
- **Upgrade**: cobra a diferença do mês na hora; o plano novo vale quando o pagamento for confirmado.
- **Downgrade**: só vale no próximo ciclo e só se o uso atual couber no plano menor (WhatsApps e pessoas).
- **Cancelar**: o acesso continua até o fim do período já pago. Dá para **reativar** nesse período.
- Pagamento **atrasado**: há `BILLING_GRACE_DAYS` dias (padrão 5) de carência. Depois disso, ou com o teste vencido, ou com a
  assinatura cancelada e vencida, a conta entra em **modo restrito**.
- **Modo restrito**: o app abre, as mensagens continuam chegando e a resposta manual funciona. Ficam pausados: respostas de IA,
  follow-up, disparos, lembretes automáticos, criar WhatsApp e convidar pessoas. **Nenhum dado é apagado.**
  Admin e atendente veem o aviso "fale com o dono da conta".
- Cota de respostas de IA do plano (500 / 3.000 / ilimitado): ao atingir, a IA para naquele mês e a conversa passa para uma pessoa.

Preços padrão (os mesmos do app): Essencial R$ 79, Pro R$ 149, Negócios R$ 299. Para mudar, defina
`PLAN_PRICE_ESSENCIAL`, `PLAN_PRICE_PRO` e `PLAN_PRICE_NEGOCIOS` (em reais, ex.: `159.90`). Os limites ficam em `src/lib/plans.ts`.

## 1. Criar a conta no Asaas

1. Acesse https://www.asaas.com e crie a conta (use o CNPJ da empresa). Conclua a validação de dados e a aprovação da conta.
2. Para testar sem dinheiro de verdade, crie também uma conta **Sandbox**: https://sandbox.asaas.com (cadastro separado).

## 2. Pegar a chave de API

No painel do Asaas: **Integrações > Chaves de API > Gerar chave**. Copie na hora (ela só aparece uma vez).
Sandbox e produção têm chaves diferentes.

## 3. Variáveis do servidor

Em `deploy/.env.production` (o `deploy/gen-env.mjs` preserva o que já existe e gera `ASAAS_WEBHOOK_TOKEN` sozinho):

```
BILLING_ENABLED=false            # só vire true no passo 6
ASAAS_BASE_URL=https://api-sandbox.asaas.com   # produção: https://api.asaas.com
ASAAS_API_KEY=<a chave do passo 2>
ASAAS_WEBHOOK_TOKEN=<valor longo e secreto; o mesmo do passo 4>
TRIAL_DAYS=7
BILLING_GRACE_DAYS=5
```

Nunca commite chaves. O repositório é público.

## 4. Cadastrar o webhook

No Asaas: **Integrações > Webhooks > Criar webhook** (cobranças e assinaturas):

- URL: `https://pearchat.online/api/billing/asaas`
- Token de autenticação: o mesmo valor de `ASAAS_WEBHOOK_TOKEN` (o Asaas envia no cabeçalho `asaas-access-token`)
- Eventos: todos os de **cobrança** (`PAYMENT_*`) e de **assinatura** (`SUBSCRIPTION_*`)
- Fila de sincronização ativa; envio em formato JSON

Se o endereço ficar fora do ar por muitas tentativas, o Asaas pausa a fila; reative-a no painel (eventos ficam guardados por 14 dias).

## 5. Testar no sandbox

1. Com as variáveis do sandbox e `BILLING_ENABLED=true` em um ambiente de teste, crie uma conta nova: ela entra em teste grátis.
2. Em **Plano e pagamento**, informe um CPF de teste válido, escolha Pix e clique em **Assinar** num plano. A fatura do sandbox abre em nova aba.
3. No painel do sandbox, abra a cobrança e use **"Confirmar pagamento"** (simulação). O Asaas chama o webhook e a conta passa para **Ativa**.
4. Teste também upgrade, downgrade, cancelar e reativar. Para simular atraso, altere o vencimento da cobrança no painel do sandbox.

## 6. Ligar em produção

1. Chave e URL de **produção** em `ASAAS_API_KEY` e `ASAAS_BASE_URL=https://api.asaas.com`; webhook cadastrado na conta de produção (passo 4).
2. Defina `BILLING_ENABLED=true` e faça o deploy (a migration `0017_billing` roda no deploy).
3. Confira: uma conta isenta (a sua) continua igual; crie uma conta nova e veja o teste grátis; faça uma assinatura real de valor baixo
   (altere temporariamente `PLAN_PRICE_ESSENCIAL`) e confirme o fluxo completo.
4. A página inicial (landing) ainda mostra o aviso "A cobrança ainda não está ativa" em `src/components/site/pricing-notice.tsx`:
   troque o texto quando ligar.

Para desligar de novo, volte `BILLING_ENABLED=false`: o app volta ao comportamento anterior (as assinaturas continuam no Asaas).

## Referências

- Documentação: https://docs.asaas.com (assinaturas, cobranças, webhooks)
- Sandbox: https://api-sandbox.asaas.com (API) e https://sandbox.asaas.com (painel)
