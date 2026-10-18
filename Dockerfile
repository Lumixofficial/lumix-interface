ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
WORKDIR /app

# Stage 1: install dependencies exactly as pinned in the lockfile.
FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# The postinstall hook patches @bluxcc/core, so its script must exist before npm ci.
COPY scripts/patch-blux-spot.cjs ./scripts/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# Stage 2: build the standalone Next.js bundle.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the bundle by `next build`, so they are
# build arguments rather than runtime environment. Changing them needs a rebuild.
ARG NEXT_PUBLIC_BLUX_APP_ID
ARG NEXT_PUBLIC_STELLAR_HORIZON_URL
ARG NEXT_PUBLIC_STELLAR_RPC_URL
ARG NEXT_PUBLIC_STELLAR_EXPLORER_URL
ARG NEXT_PUBLIC_STELLAR_USDC_ISSUER
ARG NEXT_PUBLIC_STELLAR_USDC_SAC_ADDRESS
ARG NEXT_PUBLIC_STELLAR_OPTIONS_CONTRACT_ADDRESS
ARG NEXT_PUBLIC_STELLAR_PERPETUALS_CONTRACT_ADDRESS
ARG NEXT_PUBLIC_PERPETUALS_PAYMENT_DESTINATION

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 3: minimal runtime with only the traced server files and static assets.
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs \
 && mkdir .next \
 && chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
