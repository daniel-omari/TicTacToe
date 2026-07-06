// npm install ws express sqlite3 cors
// node server.js

const WebSocket = require('ws');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();

const express = require('express');
const app = express();

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const cors = require('cors');
app.use(cors());

// DATABASE INTEGRATION
// Initialize SQLite database
const db = new sqlite3.Database('tic_tac_toe.db', (err) => {
    console.log("Connected to SQLite database.");
    db.run(`CREATE TABLE IF NOT EXISTS game_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        winner TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

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

function handleJoin(ws, data) {
    // Validate the room id and refuse a second join from the same socket.
    if (typeof data.room !== 'string' || !ROOM_ID_PATTERN.test(data.room) || ws.room) {
        return;
    }

    // Create the room if it doesn't exist
    const room = rooms[data.room] || { players: [], board: Array(9).fill(""), turn: 'X' };
    rooms[data.room] = room;  // Ensure that the room is added to the rooms object

    // Check if room is full
    if (room.players.length >= 2) {
        safeSend(ws, { type: "full" });
        return;
    }

    room.players.push(ws);
    ws.room = data.room;
    ws.symbol = room.players.length === 1 ? "X" : "O";

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

function handleMove(ws, data) {
    // The move is only trusted for the room and symbol the SERVER assigned to
    // this connection - never the ones claimed in the message - so a client
    // cannot move for their opponent or into a room they never joined.
    const room = rooms[ws.room];
    if (!room || !room.players.includes(ws)) return;
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
        db.run("INSERT INTO game_results (winner) VALUES (?)", [winner], (err) => {
            if (err) {
                console.error("Error saving game result:", err.message);
            } else {
                console.log(`Game result saved: ${winner}`);
            }
        });

        // Inform both players of the game result
        room.players.forEach((player) => {
            safeSend(player, {
                type: "game_over",
                winner: winner,
                winning_combination: winningCombination
            });
        });

        // Notify both players with the updated board and turn (game over)
        room.players.forEach((player) => {
            safeSend(player, {
                type: "update",
                board: room.board,
                turn: null  // game over, no more turns
            });
        });

        // Free the room so the next pair of players can use it (the finished
        // game used to leave the room permanently full).
        delete rooms[ws.room];
        room.players.forEach((player) => { player.room = undefined; });
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
        } catch (err) {
            console.error("Error handling message:", err.message);
        }
    });

    // When a player disconnects, clean up the room
    ws.on('close', () => {
        Object.keys(rooms).forEach((roomId) => {
            const room = rooms[roomId];

            // Remove the player from the room
            room.players = room.players.filter(player => player !== ws);

            // If no players remain, delete the room
            if (room.players.length === 0) {
                delete rooms[roomId];
            } else {
                // Inform the remaining player that the opponent left
                safeSend(room.players[0], { type: "opponent_left" });
            }
        });
    });
});

app.get('/leaderboard', (req, res) => { // display leaderboard
    db.all("SELECT winner, COUNT(*) as wins FROM game_results GROUP BY winner ORDER BY wins DESC;", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

server.listen(3000, () => console.log('Server running on port 3000'));
