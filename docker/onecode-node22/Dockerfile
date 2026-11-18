FROM node:22-slim

ENV NODE_ENV=production
ENV ONECODE_STARTUP_MIGRATIONS_IN_PROCESS=1
ENV ONECODE_CDN_BASE=https://cdn.jsdelivr.net/npm/@onescience/onecode-web@1.14.50/
ENV OPENCODE_DISABLE_EMBEDDED_WEB_UI=1
ENV ONECODE_EXTRA_PATH=/data/guest_data
ENV OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY=/data/guest_data/case

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates git unzip curl ripgrep \
    openssh-client sshpass bubblewrap \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app
# Provide docker/onecode-node22/bun before building, or use the bind-mount docker run flow in docs.
COPY docker/onecode-node22/bun /usr/local/bin/bun
COPY docker/onecode-node22/entrypoint.sh /usr/local/bin/onecode-node22-entrypoint
RUN chmod +x /usr/local/bin/bun /usr/local/bin/onecode-node22-entrypoint \
  && mkdir -p /data/guest_data/case

EXPOSE 8004
ENTRYPOINT ["/usr/local/bin/onecode-node22-entrypoint"]
