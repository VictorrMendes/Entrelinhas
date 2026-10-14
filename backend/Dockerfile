FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

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
