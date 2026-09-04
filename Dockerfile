# Recourse — production image.
#
# The protocol persists its ledger to disk, so mount a volume at /app/.recourse
# on whichever host you use. Everything else is stateless.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# The ledger lives here. Mount a volume so protected transactions survive deploys.
ENV RECOURSE_STORE_FILE=/app/.recourse/ledger.json

RUN addgroup -g 1001 -S nodejs && adduser -S recourse -u 1001

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/.next        ./.next
COPY --from=builder /app/public       ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/scripts      ./scripts
COPY --from=builder /app/data         ./data
COPY --from=builder /app/contracts    ./contracts
COPY --from=builder /app/genlayer.deployment.json ./genlayer.deployment.json

RUN mkdir -p /app/.recourse && chown -R recourse:nodejs /app/.recourse
USER recourse

EXPOSE 3000
CMD ["npm", "run", "start"]
