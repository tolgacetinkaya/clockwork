FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/panel/package.json packages/panel/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/adapter-claude/package.json packages/adapter-claude/package.json
RUN npm ci --no-audit --no-fund

COPY packages/ ./packages/
COPY docker/ ./docker/
RUN npm run build
RUN mkdir -p /data/.teamsmith && chown -R node:node /data

ENV NODE_ENV=production
ENV PANEL_PORT=47831
ENV PANEL_PROJECT_DIR=/data
USER node
EXPOSE 47831
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PANEL_PORT+'/api/state').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "docker/panel.ts"]
