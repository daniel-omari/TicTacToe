# One small image that serves the page, the WebSocket game server and the leaderboard
# API together (used for the live demo on Render, but runs anywhere Docker does).
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Install only the runtime dependencies, from the lockfile, before copying the code so
# this layer stays cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js game.js index.html styles.css ticTacToe.js ./

# Hosts like Render set PORT themselves; 3000 is the default for a plain `docker run`.
# The image's files are read-only to the app user, so the SQLite database lives in /tmp
# (it starts empty whenever the container restarts).
ENV PORT=3000
ENV DB_PATH=/tmp/tic_tac_toe.db
EXPOSE 3000

# Run as the image's unprivileged "node" user.
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
