# Draft XI League: one image that serves the API, realtime and the built web app on one port.

# ---- build: install every workspace and build the web app ----
FROM node:24-bookworm-slim AS build
# Toolchain for better-sqlite3 if no prebuilt binary matches the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
COPY data data
COPY scripts scripts
RUN npm run build

# ---- runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:var/draft-xi.db
WORKDIR /app
# The server runs TypeScript through tsx (no separate compile step), so node_modules come along whole.
COPY --from=build /app /app
RUN mkdir -p var && chown -R node:node var
USER node
EXPOSE 3000
VOLUME ["/app/var"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
