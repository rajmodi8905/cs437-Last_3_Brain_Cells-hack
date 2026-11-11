# Build from the pilot repository root. Record resolved digests with every release.
ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY tests ./tests
COPY docs ./docs
COPY pilot ./pilot
# The engine host page for the WhatsApp channel goes to .cache/engine-host-dist, never dist/.
RUN npm run build && node pilot/scripts/build-server.mjs && npm run build:engine-host

# Local checker targets are separate from the final production runtime below.
FROM dependencies AS checker-test-dependencies
RUN apt-get update && apt-get install -y --no-install-recommends curl git openssl \
    && rm -rf /var/lib/apt/lists/*
RUN npx playwright install --with-deps chromium

FROM checker-test-dependencies AS checker-tests
COPY --from=build /build/ /build/
COPY SPEC.md eslint.config.js playwright*.ts .gitignore .prettierrc.json ./
COPY .cache/checker-git/ ./.git/
RUN mkdir -p .git/refs
ENV PLAYWRIGHT_HTML_OPEN=never
CMD ["node", "pilot/scripts/checker-tests.mjs"]

FROM ${NODE_IMAGE} AS checker
ENV NODE_ENV=production PILOT_HOST=0.0.0.0 PILOT_PORT=4600 PILOT_STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=build --chown=node:node /build/dist ./dist
COPY --from=build --chown=node:node /build/.cache/pilot-server ./server
COPY --chown=node:node pilot/deploy/checker-entrypoint.mjs ./checker-entrypoint.mjs
RUN mkdir /app/checker-state && chown node:node /app/checker-state
USER node
EXPOSE 4600
ENTRYPOINT ["node", "/app/checker-entrypoint.mjs"]

FROM ${NODE_IMAGE} AS runtime
ARG SOURCE_REVISION=uncommitted
LABEL org.opencontainers.image.title="Campus Recall pilot" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
ENV NODE_ENV=production \
    PILOT_HOST=0.0.0.0 \
    PILOT_PORT=4600 \
    PILOT_STATIC_DIR=/app/dist \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
# The WhatsApp engine host (docs/pilot/whatsapp.md) runs the app's engine in Playwright's headless
# Chromium. Both are installed read-only for the app user and start only with the channel's
# settings; model files come from a volume filled at release (pilot/deploy/fill-models.mjs).
COPY --from=dependencies /build/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=dependencies /build/node_modules/playwright ./node_modules/playwright
COPY --from=dependencies /build/node_modules/@playwright/test ./node_modules/@playwright/test
RUN node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/*
COPY --from=build --chown=node:node /build/dist ./dist
COPY --from=build --chown=node:node /build/.cache/pilot-server ./server
COPY --from=build --chown=node:node /build/.cache/engine-host-dist ./engine-host
COPY --chown=node:node pilot/deploy/entrypoint.mjs ./entrypoint.mjs
COPY --chown=node:node pilot/deploy/fill-models.mjs ./fill-models.mjs
USER node
EXPOSE 4600
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4600/api/v1/config').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["node", "/app/entrypoint.mjs"]
CMD ["/app/server/main.mjs"]
