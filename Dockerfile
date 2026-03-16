FROM node:20-bookworm-slim AS base

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS builder

COPY . .
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/scripts/start-cloud-run.sh ./scripts/start-cloud-run.sh

RUN mkdir -p uploads renders prisma \
  && chmod +x ./scripts/start-cloud-run.sh

EXPOSE 8080

CMD ["./scripts/start-cloud-run.sh"]
