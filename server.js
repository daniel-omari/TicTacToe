// npm install
// npm start

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const TicTacToeGame = require('./game.js');

const express = require('express');
const app = express();
app.disable('x-powered-by');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const cors = require('cors');
app.use(cors());

// Game results live in SQLite via Node's built-in driver (no native add-on to build).
// DB_PATH lets the tests use a throwaway in-memory database (":memory:").
const db = new DatabaseSync(process.env.DB_PATH || 'tic_tac_toe.db');
db.exec(`CREATE TABLE IF NOT EXISTS game_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    winner TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
const insertResult = db.prepare("INSERT INTO game_results (winner) VALUES (?)");
const selectLeaderboard = db.prepare(
    "SELECT winner, COUNT(*) AS wins FROM game_results GROUP BY winner ORDER BY wins DESC"
);

// Every room by its code. Private rooms are joined by typing the code; quick-match
// rooms are public and pair up strangers (their code is never shown).
const rooms = new Map();

// Codes skip look-alike characters (0/O, 1/I/L) so they are easy to read out and type.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

function newRoomCode() {
    let code;
    do {
        code = "";
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
        }
    } while (rooms.has(code));
    return code;
}

function createRoom(isPrivate) {
    const code = newRoomCode();
    const room = { code, isPrivate, players: [] };
    resetRoom(room);
    rooms.set(code, room);
    return room;
}

// Send JSON to a client only if its socket is still open.
function safeSend(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

// Put a room back to an empty board with X to move.
function resetRoom(room) {
    room.board = TicTacToeGame.emptyBoard();
    room.turn = "X";
    room.finished = false;      // true between game over and a rematch
    room.rematchVotes = new Set();
}

// Seat a player in a room with a free symbol, then wait or start the game.
function addPlayer(ws, room) {
    // Take whichever symbol is still free (not "first in = X"), so a player who
    // joins after someone left can never end up with the same symbol as the other.
    const taken = room.players.map((player) => player.symbol);
    room.players.push(ws);
    ws.room = room.code;
    ws.symbol = taken.includes("X") ? "O" : "X";
    safeSend(ws, { type: "assign", symbol: ws.symbol });

    if (room.players.length < 2) {
        safeSend(ws, { type: "waiting" });
        return;
    }
    room.players.forEach((player) => safeSend(player, { type: "start" }));
}

// "create": open a private room and tell the creator its code to share.
function handleCreate(ws) {
    if (ws.room) return; // one room per connection
    const room = createRoom(true);
    safeSend(ws, { type: "room", code: room.code });
    addPlayer(ws, room);
}

// "join": take the free seat in a private room, by its code.
function handleJoin(ws, data) {
    if (ws.room) return;
    const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
    const room = rooms.get(code);
    if (!room || !room.isPrivate) {
        safeSend(ws, { type: "not_found" });
        return;
    }
    if (room.players.length >= 2) {
        safeSend(ws, { type: "full" });
        return;
    }
    safeSend(ws, { type: "room", code: room.code });
    addPlayer(ws, room);
}

// "quick": pair with whoever has been waiting longest, or wait for the next player.
function handleQuickMatch(ws) {
    if (ws.room) return;
    let room = [...rooms.values()].find((r) => !r.isPrivate && r.players.length === 1);
    if (!room) room = createRoom(false);
    addPlayer(ws, room);
}

// Apply one validated move, then broadcast the new state or the game result.
function handleMove(ws, data) {
    // The move is only trusted for the room and symbol the SERVER assigned to
    // this connection - never the ones claimed in the message - so a client
    // cannot move for their opponent or into a room they never joined.
    const room = rooms.get(ws.room);
    if (!room || !room.players.includes(ws)) return;
    if (room.finished) return;                      // game over, waiting for a rematch
    if (room.players.length < 2) return;            // no solo play before an opponent joins
    if (room.turn !== ws.symbol) return;            // not this player's turn

    // Validate the cell index and make sure it's empty.
    const index = data.index;
    if (!Number.isInteger(index) || index < 0 || index > 8) return;
    if (room.board[index] !== "") return;

    // Make the move and update the turn
    room.board[index] = ws.symbol;
    room.turn = room.turn === "X" ? "O" : "X";

    // Check for a win or draw with the shared rules (the same code the browser uses)
    const result = TicTacToeGame.getResult(room.board);
    if (result) {
        const { winner, line } = result;

        // Store the result in the database
        try {
            insertResult.run(winner);
        } catch (err) {
            console.error("Error saving game result:", err.message);
        }

        // Send the final board first, then the result, so the result message
        // is the last thing each client renders.
        room.players.forEach((player) => {
            safeSend(player, { type: "update", board: room.board, turn: null });
            safeSend(player, {
                type: "game_over",
                winner: winner,
                winning_combination: line
            });
        });

        // Keep both players in the room so they can ask for a rematch. The room is
        // freed when they leave (see the close handler).
        room.finished = true;
        return; // exit the move handler once the game is over
    }

    // If no winner, update the board for both players
    room.players.forEach((player) => {
        safeSend(player, {
            type: "update",
            board: room.board,
            turn: room.turn
        });
    });
}

// A finished game restarts once both players ask for a rematch. They swap
// symbols, so whoever went second last game starts as X (X always moves first).
function handleRematch(ws) {
    const room = rooms.get(ws.room);
    if (!room || !room.finished || !room.players.includes(ws)) return;

    room.rematchVotes.add(ws);
    if (room.rematchVotes.size < 2) {
        room.players.forEach((player) => {
            if (player !== ws) safeSend(player, { type: "rematch_requested" });
        });
        return;
    }

    resetRoom(room);
    room.players.forEach((player) => {
        player.symbol = player.symbol === "X" ? "O" : "X";
        safeSend(player, { type: "assign", symbol: player.symbol });
        safeSend(player, { type: "start" });
    });
}

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        // A malformed frame must never take the server down.
        let data;
        try {
            data = JSON.parse(message);
        } catch {
            return;
        }
        if (!data || typeof data !== 'object') return;

        try {
            if (data.type === 'create') handleCreate(ws);
            if (data.type === 'join') handleJoin(ws, data);
            if (data.type === 'quick') handleQuickMatch(ws);
            if (data.type === 'move') handleMove(ws, data);
            if (data.type === 'rematch') handleRematch(ws);
        } catch (err) {
            console.error("Error handling message:", err.message);
        }
    });

    // When a player disconnects, free their seat. Whoever is left gets a fresh
    // board and waits for a new opponent as X, instead of keeping the old,
    // half-played game (which a newcomer would then have joined mid-way).
    ws.on('close', () => {
        const room = rooms.get(ws.room);
        if (!room) return;

        room.players = room.players.filter((player) => player !== ws);
        if (room.players.length === 0) {
            rooms.delete(ws.room);
            return;
        }

        const remaining = room.players[0];
        resetRoom(room);
        remaining.symbol = "X";
        safeSend(remaining, { type: "opponent_left" });
        safeSend(remaining, { type: "assign", symbol: "X" });
    });
});

// The game page itself, so one server hosts everything. Only these files are public;
// everything else in the folder (server code, the database, package files) stays private.
const PUBLIC_FILES = ['index.html', 'styles.css', 'game.js', 'ticTacToe.js'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
PUBLIC_FILES.forEach((file) => {
    app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
});

// Win tally per symbol (X, O and draws).
app.get('/leaderboard', (req, res) => {
    try {
        res.json(selectLeaderboard.all());
    } catch (err) {
        console.error("Error reading leaderboard:", err.message);
        res.status(500).json({ error: "Could not load the leaderboard" });
    }
});

// Only start listening when run directly (npm start). The tests import this file and
// start it on a random free port instead.
const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = { server, wss };
