# Tic-Tac-Toe

A web-based Tic-Tac-Toe game with three ways to play: local two-player, against an
AI with selectable difficulty, and online multiplayer against another person over the
network. The frontend is vanilla HTML, CSS and JavaScript with no frameworks; the
backend is a small Node server that handles real-time matches over WebSockets and keeps
a results leaderboard in SQLite. Built as a personal project to dig into game AI and
real-time multiplayer.

## Game modes

- **Local (offline):** two players share one keyboard and mouse on the same board.
- **Versus AI:** play the computer at one of three difficulty levels (Naive, Intermediate,
  Advanced).
- **Online:** two browsers join the same room and play in real time, with the server
  acting as the source of truth for the board and recording the result.
- **Leaderboard:** a running tally of wins by symbol, served from the database.

## The AI

The AI is built on the minimax algorithm with alpha-beta pruning, and the difficulty
levels change how strictly it follows the optimal strategy:

- **Naive** moves randomly among the empty cells.
- **Intermediate** plays the optimal minimax move about 70% of the time and a random move
  otherwise, so it is beatable but not a pushover.
- **Advanced** runs a full minimax search on every move, which makes it effectively
  unbeatable (the best a human can manage is a draw).

Minimax scores each terminal position (a win for the AI, a win for the player, or a draw)
and backs those scores up the game tree, picking the move that maximises its worst-case
outcome. Alpha-beta pruning discards branches that cannot affect the final choice, which
cuts the search work without changing the result.

## Online multiplayer

The Node server (`server.js`) runs a WebSocket endpoint and a small HTTP API. Players are
matched into a room; the server holds the authoritative board, validates each move
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
- SQLite (via `sqlite3`) for storing game results and the leaderboard.
- Responsive CSS with media queries for mobile and tablet layouts.

## Project structure

- `index.html`: page markup, the menu, the board, and the leaderboard view.
- `styles.css`: all styling, including the per-mode colour themes and responsive layouts.
- `ticTacToe.js`: client-side game logic, the AI (minimax and difficulty levels), and the
  WebSocket client for online play.
- `server.js`: the WebSocket and HTTP server, room/matchmaking logic, and the SQLite
  leaderboard.

## Running

Local and versus-AI play need no server: just open `index.html` in a browser.

For online multiplayer and the leaderboard, start the server:

```bash
npm install     # installs express, ws, sqlite3, cors
npm start       # starts the server on port 3000
```

Then open `index.html` in two browser tabs or on two machines and choose Play Online. The
server creates `tic_tac_toe.db` automatically on first run.

## Notes

This is a hobby project. The online mode uses a single fixed room and a hardcoded
`localhost:3000` server address, which are fine for local play and a demo but would need
configurable rooms and a deployed server address for real use.
