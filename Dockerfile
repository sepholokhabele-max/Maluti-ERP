# Maluti ERP – web version (hosted). The same server as the desktop app, without Electron.
#   docker compose up -d        (see docker-compose.yml and README "Web version")
FROM node:20-alpine
RUN apk add --no-cache tzdata
ENV NODE_ENV=production PORT=8069
WORKDIR /app
COPY package.json package-lock.json ./
# only the server's packages (Electron and the Windows build tools are left out)
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY public ./public
COPY plugins ./plugins
COPY tools ./tools
COPY CHANGELOG-latest.md README.md ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV MALUTI_CONFIG=/data/config.json
EXPOSE 8069
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD wget -qO- http://127.0.0.1:8069/api/status >/dev/null || exit 1
CMD ["node", "server/standalone.js"]
