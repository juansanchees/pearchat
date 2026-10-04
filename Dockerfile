# syntax=docker/dockerfile:1
# PearChat: Next.js 14 + Socket.io (servidor custom server.ts rodado com tsx).
FROM node:22-slim AS base
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
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_WA_MOCK=$NEXT_PUBLIC_WA_MOCK \
    NEXT_PUBLIC_META_APP_ID=$NEXT_PUBLIC_META_APP_ID \
    NEXT_PUBLIC_META_CONFIG_ID=$NEXT_PUBLIC_META_CONFIG_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    MEDIA_DIR=/data/media
# node_modules completo de propósito: tsx (runtime) e prisma CLI (migrate deploy) precisam estar presentes.
COPY --from=builder --chown=node:node /app /app
# Mídias das conversas (volume pearchat_media): precisa existir e pertencer ao usuário não-root; o volume nomeado herda isto.
RUN mkdir -p /data/media && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server.ts", "--prod"]
