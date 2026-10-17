# Hermes UI+ Bridge - small image, non-root. No prebuilt image is published in 0.1; build from this directory (a git checkout):
#   npm run bundle-skill            # copies ../hermes-skill into ./skill (or: npm run docker:build)
#   docker build -t hermes-ui-plus-bridge .
# Without Node on the host: mkdir -p skill && cp -r ../hermes-skill/hermes-ui ../hermes-skill/bootstrap-system-message.txt skill/
# (the state path /var/lib/hermes-ui-bridge keeps its pre-rename name so existing volumes keep working)
FROM node:25-alpine
# HUI_BRIDGE_IMAGE=1: this official image; the startup pair hint then says `docker compose exec bridge ...`
ENV NODE_ENV=production \
    HUI_BRIDGE_IMAGE=1 \
    BRIDGE_HOST=0.0.0.0 \
    BRIDGE_PORT=8790 \
    BRIDGE_STATE_DIR=/var/lib/hermes-ui-bridge
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY bin ./bin
COPY src ./src
# The skill + bootstrap system message (generated ./skill, see above). Without the bootstrap message the bridge cannot
# tell Hermes about the app's components and every answer stays plain Markdown, so a missing copy fails the build.
COPY skill ./skill
RUN test -s skill/bootstrap-system-message.txt && test -s skill/hermes-ui/SKILL.md \
  || { echo 'skill/ is incomplete: run `npm run bundle-skill` in bridge/ before docker build' >&2; exit 1; }
# uploads + generated token live in the volume; owned by the unprivileged "node" user (uid 1000)
RUN mkdir -p /var/lib/hermes-ui-bridge && chown node:node /var/lib/hermes-ui-bridge
USER node
VOLUME ["/var/lib/hermes-ui-bridge"]
EXPOSE 8790
# Liveness of the bridge itself: /bridge/live needs no token and does not depend on Hermes being up (an authenticated
# path here would log a 401 every 30 s).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BRIDGE_PORT||8790)+'/bridge/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# `--` before the script: Node.js itself would otherwise grab a `--env-file` argument meant for the bridge and stop with
# a bare "node: <file>: not found"; this way the bridge reports a missing file itself.
ENTRYPOINT ["node", "--", "bin/hermes-ui-bridge.mjs"]
CMD []
