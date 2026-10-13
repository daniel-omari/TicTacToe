# One small image that serves the page, the WebSocket game server and the leaderboard
# API together (used for the live demo on Render, but runs anywhere Docker does).

# ---- Build: compile the TypeScript (server, browser client, shared game code) ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY test ./test
RUN npm run build

# ---- Run: only the runtime dependencies, the compiled code and the page ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# Install the runtime dependencies from the lockfile before copying the code, so this
# layer stays cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist/src ./dist/src
COPY public ./public

# Hosts like Render set PORT themselves; 3000 is the default for a plain `docker run`.
# The image's files are read-only to the app user, so the SQLite database lives in /tmp
# (it starts empty whenever the container restarts).
ENV PORT=3000
ENV DB_PATH=/tmp/tic_tac_toe.db
EXPOSE 3000

# Run as the image's unprivileged "node" user.
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/src/server/main.js"]
