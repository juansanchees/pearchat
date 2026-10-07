# syntax=docker/dockerfile:1
# PearChat: Next.js 14 + Socket.io (servidor custom server.ts rodado com tsx).
FROM node:25-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS builder
# O postinstall roda `prisma generate`, então o schema precisa estar presente antes do npm ci.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
# NEXT_PUBLIC_* são embutidas no bundle em tempo de build.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_WA_MOCK=false
ARG NEXT_PUBLIC_META_APP_ID=
ARG NEXT_PUBLIC_META_CONFIG_ID=
# Imagem de produção NUNCA nasce com o modo de demonstração do WhatsApp embutido no site.
RUN if [ "$NEXT_PUBLIC_WA_MOCK" = "true" ] || [ "$NEXT_PUBLIC_WA_MOCK" = "1" ]; then echo "ERRO: NEXT_PUBLIC_WA_MOCK ligado no build da imagem de producao" >&2; exit 1; fi
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_WA_MOCK=$NEXT_PUBLIC_WA_MOCK \
    NEXT_PUBLIC_META_APP_ID=$NEXT_PUBLIC_META_APP_ID \
    NEXT_PUBLIC_META_CONFIG_ID=$NEXT_PUBLIC_META_CONFIG_ID \
    NEXT_TELEMETRY_DISABLED=1
# (o cache do webpack não é preciso em runtime; em produção o compose monta um tmpfs em /app/.next/cache)
RUN npx prisma generate && npm run build && rm -rf .next/cache

FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    MEDIA_DIR=/data/media
# node_modules completo de propósito: tsx (runtime) e prisma CLI (migrate deploy) precisam estar presentes.
COPY --from=builder --chown=node:node /app /app
# Mídias das conversas (volume pearchat_media): precisa existir e pertencer ao usuário não-root; o volume nomeado herda isto.
RUN mkdir -p /data/media && chown -R node:node /data
# Usuário não-root (uid 1000). O compose roda o app com sistema de arquivos somente leitura: o que precisa de escrita
# é /tmp e /app/.next/cache (tmpfs no compose) e /data/media (volume).
USER node
EXPOSE 3000
# /api/health devolve 503 quando o banco não responde (o /login passava com o banco fora).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Sem npx: o PID 1 (ou o filho do init do compose) é o próprio tsx, que repassa SIGTERM ao servidor.
CMD ["node_modules/.bin/tsx", "server.ts", "--prod"]
