# SynapseNest production image — Node 22 slim, non-root
FROM node:22-slim

# Docker CLI (client only) for RuntimeAdapter → host docker.sock (BusyBox previews)
# RISK: mounting the host socket grants container control of the host Docker daemon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in amd64) DARCH=x86_64 ;; arm64) DARCH=aarch64 ;; *) DARCH=$ARCH ;; esac \
  && curl -fsSL "https://download.docker.com/linux/static/stable/${DARCH}/docker-27.5.1.tgz" \
    | tar -xz -C /tmp \
  && mv /tmp/docker/docker /usr/local/bin/docker \
  && rm -rf /tmp/docker \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json package-lock.json ./

# Production deps only (wrangler is devDependency; app uses Node built-ins)
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY templates ./templates

# Ensure data mount points exist (bind-mounted at runtime)
RUN mkdir -p /app/data/workspaces /app/data/exports \
  && chown -R node:node /app

USER node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]
