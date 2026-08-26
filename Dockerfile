# syntax=docker/dockerfile:1.7
#
# Standalone HanaAgent server, Linux only.
#
# Prerequisite: this Dockerfile assumes `dist-server/linux-x64/` is already
# present on the build context. The companion
#   scripts/build-server-docker-image.mjs
# wraps `node scripts/build-server.mjs linux x64` (artifact build) plus
# `docker build` plus tagging, so an end user never has to copy the artifact
# manually. Building the server artifact inside this Dockerfile would couple
# image builds to source-level network access and bundler caches; the wrapper
# script keeps image builds small and CI-cheap.
#
# base: node:24-bookworm-slim — pinned in package.json:engines.node.
# runtime user: uid 1000 (the upstream image's built-in `node` user).
# runtime env: HANA_HOME=/hana/home, HOST=0.0.0.0, PORT=7777.
FROM node:24-bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive

# bubblewrap is required by the agent's bash sandbox (lib/sandbox/bwrap.ts).
# `bwrap` is probed via `which`; missing it would fail-closed at every bash
# tool call rather than silently falling back to host execution.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        bubblewrap \
        ca-certificates \
        tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1000 node 2>/dev/null || true \
 && useradd  --system --uid 1000 --gid node --home /hana/home --shell /bin/bash node 2>/dev/null || true

WORKDIR /app
COPY --chown=1000:1000 dist-server/linux-x64/ /app/

# Persistent data lives outside the image. chown at build time so the named
# volume's first mount already has the right ownership; the server itself
# chmods secrets to 0o600 at startup (shared/secret-fs.ts).
RUN mkdir -p /hana/home && chown -R 1000:1000 /hana/home

ENV HANA_HOME=/hana/home \
    # Only HANA_PORT is read by the server (server/index.ts:353). The bind
    # host comes from HANA_HOME/server-network.json (loopback by default);
    # switch to LAN mode via `PUT /api/access/network` after first start.
    HANA_PORT=7777 \
    HOME=/hana/home \
    NODE_ENV=production \
    HANA_SERVER_OWNER=standalone

VOLUME ["/hana/home"]
EXPOSE 7777

USER 1000:1000
ENTRYPOINT ["/app/hana-server"]