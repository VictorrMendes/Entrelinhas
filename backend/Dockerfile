FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# the base image's Alpine packages get their security fixes before a newer image is out
RUN apk upgrade --no-cache

COPY package.json package-lock.json ./
# npm and corepack are only needed to install: removed, they leave neither unused code nor their dependencies' CVEs behind
RUN npm ci --omit=dev && npm cache clean --force   && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Node runs the TypeScript directly (type stripping): no build step, the image ships the sources
COPY src ./src

# uid 1000 (user "node"): owner expected for ./storage mounted by the compose on Linux hosts
RUN mkdir -p /app/data && chown node /app/data
USER node

ENV DATA_DIR=/app/data PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "src/server.ts"]
