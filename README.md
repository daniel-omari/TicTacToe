# Tic-Tac-Toe

[![CI](https://github.com/daniel-omari/TicTacToe/actions/workflows/ci.yml/badge.svg)](https://github.com/daniel-omari/TicTacToe/actions/workflows/ci.yml)

A web-based Tic-Tac-Toe game with three ways to play: local two-player, against an
AI with selectable difficulty, and online multiplayer against another person over the
network. The frontend is vanilla HTML, CSS and JavaScript with no frameworks; the
backend is a small Node server that handles real-time matches over WebSockets and keeps
a results leaderboard in SQLite. Built as a personal project to dig into game AI and
real-time multiplayer.

**Play it live: [tictactoe-n3eh.onrender.com](https://tictactoe-n3eh.onrender.com)**
(free hosting, so the first visit after a quiet spell takes about a minute to wake the
server up). For online play, open it on two devices, or send a friend a private room code.

## Game modes

- **Local (offline):** two players share one keyboard and mouse on the same board.
- **Versus AI:** play the computer at one of four difficulty levels (Naive, Intermediate,
  Advanced, Unbeatable).
- **Online:** Quick Match pairs you with the next person looking for a game, or create a
  Private Room and send the 5-letter code to a friend. Play in real time, with the server
  acting as the source of truth for the board and recording the result, then Rematch to go
  again with swapped symbols.
- **Leaderboard:** a running tally of wins by symbol, served from the database.

## The AI

The levels differ in what the AI notices, not in how often it throws the game on purpose:

- **Naive** plays the best move about 60% of the time and a random move otherwise.
- **Intermediate** always takes a win and blocks about 80% of the time; otherwise it takes
  the centre or a corner with no lookahead, so it walks into forks.
- **Advanced** plays like a strong human: it never misses a win or a block, and plays the
  perfect move about 70% of the time. Otherwise it overlooks something deeper, like a fork
  two moves away. It never makes an obvious blunder, but it can be beaten from either side.
- **Unbeatable** runs a full minimax search with alpha-beta pruning on every move. The
  best a human can manage is a draw.

At every level, ties between equally good moves are broken at random, so games don't
repeat. Players swap symbols after every finished game (X always moves first), so you
take turns opening against the AI.

Minimax scores each finished position (a win for the AI, a win for the player, or a draw)
and backs those scores up the game tree, picking the move that maximises its worst-case
outcome. Faster wins score higher, so it finishes games quickly. Alpha-beta pruning skips
branches that cannot change the choice. The test suite proves Unbeatable never loses by
playing out every possible game against it, as X and as O, including every tie it might
pick.

## Online multiplayer

The Node server (`server.js`) runs a WebSocket endpoint and a small HTTP API. Players meet
in rooms: Quick Match fills public rooms in order of arrival, while a private room gets a
random 5-character code (made with `crypto.randomInt`, skipping look-alike characters such
as 0/O and 1/I/L) that only the people you share it with can use. Each connection can be in
one room at a time. The server holds the authoritative board, validates each move
(correct turn, legal cell, and the sender's own server-assigned symbol and room, so a
tampered client cannot move for its opponent), broadcasts updates to both clients, and
detects wins and draws
on its own rather than trusting the browser. Validating moves server-side keeps the two
clients in sync and stops a tampered client from making illegal moves. Every finished game
is written to a SQLite table, and the `/leaderboard` endpoint aggregates those rows into a
win count per symbol.

## Accessibility

Accessibility was a first-class goal rather than an afterthought:

- The board is keyboard playable: arrow keys move focus between cells and Enter or Space
  places a mark.
- ARIA roles and labels describe the grid and each cell, and the cell labels update as
  marks are placed.
- Status messages and end-of-game results use ARIA live regions so screen readers announce
  whose turn it is and who won.
- Focus is moved to the first cell on reset and to the leaderboard when it opens, and a
  visible focus outline is kept for keyboard users.

## Tech stack

- Vanilla HTML, CSS and JavaScript on the frontend, no frameworks.
- Node.js with Express for the HTTP API.
- `ws` for the WebSocket server that drives online play.
- SQLite through Node's built-in `node:sqlite` module for game results and the leaderboard
  (no native add-on to compile).
- Fluid, responsive CSS (`clamp()` / `min()`) that scales smoothly from phones to desktops.
- `node:test` for unit and integration tests, ESLint, and GitHub Actions CI.

## Project structure

- `index.html`: page markup, the menu, the board, and the leaderboard view.
- `styles.css`: all styling, including the per-mode colour themes and responsive layouts.
- `game.js`: the pure game rules and AI (win and draw detection, minimax with alpha-beta
  pruning, difficulty levels). It has no page or network code, and the same file is used
  by the browser, the server and the tests, so the rules only exist once.
- `ticTacToe.js`: the browser client: screens, board display, keyboard controls and the
  WebSocket client for online play.
- `server.js`: the WebSocket and HTTP server, room/matchmaking logic, and the SQLite
  leaderboard.
- `test/`: unit tests for the rules and AI, and integration tests that run the real server
  against real WebSocket clients.

## Running

Start the server (needs Node.js 22.13 or newer):

```bash
npm install     # installs express, ws and cors (plus ESLint for development)
npm start       # serves the game on http://localhost:3000 (set PORT to change it)
```

Then open http://localhost:3000 in two browser tabs or on two machines and choose Play
Online. The server hosts the page itself and the browser connects back to the same address,
so the same build works locally and when deployed. It creates `tic_tac_toe.db` on first run.

Local and versus-AI play also work without a server: just open `index.html` in a browser.

## Deploying

The `Dockerfile` builds one small image that serves everything:

```bash
docker build -t tic-tac-toe .
docker run -p 3000:3000 tic-tac-toe     # then open http://localhost:3000
```

The live demo runs this image as a free web service on Render, which builds it straight
from this repository and sets `PORT` itself. The browser connects back to whatever address
served the page, over `wss://` on HTTPS, so no URLs need changing. The server pings every
player every 30 seconds, which keeps connections open through the host's proxy and frees
the seat of anyone whose connection silently dropped.

## Testing

```bash
npm test        # unit tests for the rules and AI, plus server integration tests
npm run lint    # ESLint
```

Highlights:

- **The full-search AI is proven never to lose.** Tic-Tac-Toe is small enough to check
  exhaustively, so a test plays out every possible game against it, as X and as O, and
  fails if it ever loses.
- **The server is tested as a black box:** a real instance on a random port with real
  WebSocket clients checks matchmaking, rejection of illegal and tampered moves,
  malformed messages, rematches, players leaving mid-game, and the leaderboard API.

GitHub Actions runs linting, the tests and `npm audit` on Node 22 and 24 for every push.

## Notes

This is a hobby project. There are no accounts, so the leaderboard counts wins by symbol
(X, O and draws) rather than by player. The live demo runs on a free plan: it sleeps after 15
minutes without visitors (the first visit after that takes about a minute to wake it), and
it has no persistent disk, so its leaderboard starts from zero whenever it restarts.
