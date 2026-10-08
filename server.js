// npm install
// npm start

const WebSocket = require('ws');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');

const express = require('express');
const app = express();

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const cors = require('cors');
app.use(cors());

// Game results live in SQLite via Node's built-in driver (no native add-on to build).
const db = new DatabaseSync('tic_tac_toe.db');
db.exec(`CREATE TABLE IF NOT EXISTS game_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    winner TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
const insertResult = db.prepare("INSERT INTO game_results (winner) VALUES (?)");
const selectLeaderboard = db.prepare(
    "SELECT winner, COUNT(*) AS wins FROM game_results GROUP BY winner ORDER BY wins DESC"
);

const rooms = {};

// Room IDs are client-supplied, so keep them to a sane charset/length.
const ROOM_ID_PATTERN = /^[\w-]{1,32}$/;

// Send JSON to a client only if its socket is still open.
function safeSend(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

// Server-side winner check function
function checkOnlineWinner(board) {
    const winningPatterns = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

    for (const pattern of winningPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return { winner: board[a], winningCombination: [a, b, c] }; // return winner and the winning combination
        }
    }

    // Check for a draw
    if (board.every(cell => cell !== "")) {
        return { winner: "draw", winningCombination: [] };
    }
    return null; // No winner yet
}

// Put a room back to an empty board with X to move.
function resetRoom(room) {
    room.board = Array(9).fill("");
    room.turn = "X";
    room.finished = false;      // true between game over and a rematch
    room.rematchVotes = new Set();
}

// Add the connecting socket to a room and assign it a free symbol.
function handleJoin(ws, data) {
    // Validate the room id and refuse a second join from the same socket.
    if (typeof data.room !== 'string' || !ROOM_ID_PATTERN.test(data.room) || ws.room) {
        return;
    }

    // Create the room if it doesn't exist
    let room = rooms[data.room];
    if (!room) {
        room = { players: [] };
        resetRoom(room);
        rooms[data.room] = room;
    }

    // Check if room is full
    if (room.players.length >= 2) {
        safeSend(ws, { type: "full" });
        return;
    }

    // Take whichever symbol is still free (not "first in = X"), so a player who
    // joins after someone left can never end up with the same symbol as the other.
    const taken = room.players.map((player) => player.symbol);
    room.players.push(ws);
    ws.room = data.room;
    ws.symbol = taken.includes("X") ? "O" : "X";

    // Assign the symbol and notify the client
    safeSend(ws, { type: "assign", symbol: ws.symbol });

    // If there is only one player, inform them to wait
    if (room.players.length < 2) {
        safeSend(ws, { type: "waiting" });
        return;
    }

    // Notify both players to start the game
    room.players.forEach((player) => {
        safeSend(player, { type: "start" });
    });
}

// Apply one validated move, then broadcast the new state or the game result.
function handleMove(ws, data) {
    // The move is only trusted for the room and symbol the SERVER assigned to
    // this connection - never the ones claimed in the message - so a client
    // cannot move for their opponent or into a room they never joined.
    const room = rooms[ws.room];
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

    // Check for winner after every move
    const result = checkOnlineWinner(room.board);
    if (result) {
        const { winner, winningCombination } = result;

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
                winning_combination: winningCombination
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
    const room = rooms[ws.room];
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
        } catch (err) {
            return;
        }
        if (!data || typeof data !== 'object') return;

        try {
            if (data.type === 'join') handleJoin(ws, data);
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
        const room = rooms[ws.room];
        if (!room) return;

        room.players = room.players.filter((player) => player !== ws);
        if (room.players.length === 0) {
            delete rooms[ws.room];
            return;
        }

        const remaining = room.players[0];
        resetRoom(room);
        remaining.symbol = "X";
        safeSend(remaining, { type: "opponent_left" });
        safeSend(remaining, { type: "assign", symbol: "X" });
    });
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

server.listen(3000, () => console.log('Server running on port 3000'));
