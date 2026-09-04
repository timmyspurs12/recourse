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

# su-exec lets the entrypoint drop privileges after preparing the volume.
RUN apk add --no-cache su-exec \
 && addgroup -g 1001 -S nodejs \
 && adduser -S recourse -u 1001 -G nodejs

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/.next        ./.next
COPY --from=builder /app/public       ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/scripts      ./scripts
COPY --from=builder /app/data         ./data
COPY --from=builder /app/contracts    ./contracts
COPY --from=builder /app/genlayer.deployment.json ./genlayer.deployment.json
COPY --from=builder /app/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/.recourse && chown -R recourse:nodejs /app/.recourse

# NOTE: no USER directive. The entrypoint starts as root purely to take
# ownership of the mounted volume, then execs the app as uid 1001. Setting
# USER here would make that impossible and force the operator to run the whole
# container as root instead.
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
