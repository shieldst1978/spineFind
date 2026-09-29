# Production image for Azure Container Apps.
# Build:  docker build -t spinefind .
# Needs DATABASE_URL (hosted Postgres) and TMDB_READ_TOKEN at runtime.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# One ID per build (the git commit). Pages left open from an older version then
# reload instead of calling server actions that no longer exist.
ARG DEPLOYMENT_ID=local
ENV NEXT_DEPLOYMENT_ID=$DEPLOYMENT_ID
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# Migrations run at startup (see scripts/start.mjs), so ship them too.
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/scripts/start.mjs ./start.mjs
USER app
EXPOSE 3000
CMD ["node", "start.mjs"]
