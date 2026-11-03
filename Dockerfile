# syntax=docker/dockerfile:1
#
# The 2026 midterm forecast: a Malloy Publisher serving one package, whose public/ directory
# is the app, behind serve.mjs (static files + the one query endpoint). Same shape as
# community/apps/avalanche — see that Dockerfile for the reasoning behind each choice
# (pinned Publisher, tini as PID 1, Publisher bound to 127.0.0.1, both processes fatal).
#
# The data is a committed Parquet snapshot (package/data/, built by scripts/build-data.mjs),
# so the build touches no network beyond npm and the image is reproducible from the repo alone.

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @malloy-publisher/server@0.9.1 \
 && npm cache clean --force

WORKDIR /app

COPY publisher.config.json ./
COPY serve.mjs ./
COPY package/ ./package/

ENV NODE_ENV=production \
    PORT=8080 \
    PUBLISHER_PORT=4000
EXPOSE 8080

RUN chown -R node:node /app
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "{ malloy-publisher --server_root . --port ${PUBLISHER_PORT} --host 127.0.0.1; kill -KILL $$; } & { PORT=${PORT} PUBLISHER_PORT=${PUBLISHER_PORT} node serve.mjs; kill -KILL $$; } & wait"]
