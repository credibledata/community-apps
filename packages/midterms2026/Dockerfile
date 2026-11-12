# syntax=docker/dockerfile:1
#
# The 2026 midterm forecast: a Malloy Publisher serving one package, whose public/ directory
# is the app, behind serve.mjs (static files + the one query endpoint). Publisher is pinned, tini
# runs as PID 1, Publisher listens on 127.0.0.1 only so serve.mjs is the one way in, and either
# process exiting stops the container.
#
# Build from this folder: docker build -t midterms2026 .
#
# The data is a committed Parquet snapshot (data/, built by pipeline/), so the build touches no
# network beyond npm and the image is reproducible from the repo alone.

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @malloy-publisher/server@0.9.1 \
 && npm cache clean --force

WORKDIR /app

COPY . ./packages/midterms2026/

ENV NODE_ENV=production \
    PORT=8080 \
    PUBLISHER_PORT=4000
EXPOSE 8080

RUN chown -R node:node /app
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "{ malloy-publisher --server_root . --config packages/midterms2026/publisher.config.json --port ${PUBLISHER_PORT} --host 127.0.0.1; kill -KILL $$; } & { PORT=${PORT} PUBLISHER_PORT=${PUBLISHER_PORT} node packages/midterms2026/serve.mjs; kill -KILL $$; } & wait"]
