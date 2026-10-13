// The game server: hosts the page, runs online games over WebSockets and keeps the
// leaderboard in SQLite. main.ts starts it; the tests import it and pick their own port.

import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import * as Game from "../shared/game.js";
import type { Board, Mark } from "../shared/game.js";
import type { LeaderboardRow, ServerMessage } from "../shared/protocol.js";

// A connected browser: the socket plus what the server knows about it
interface Player extends WebSocket {
    room?: string;              // code of the room it is in
    symbol?: Mark;              // the symbol the server gave it
    playerId: string | null;    // its secret browser ID, or null for a guest
    playerName: string;
    isAlive: boolean;           // answered the last heartbeat ping
}

interface Room {
    code: string;
    isPrivate: boolean;         // joined by code, never used by quick match
    players: Player[];
    board: Board;
    turn: Mark;
    finished: boolean;          // true between game over and a rematch
    rematchVotes: Set<Player>;
}

// Incoming messages are untrusted JSON, so every field is checked before it is used
type Incoming = Record<string, unknown>;

export const app = express();
app.disable("x-powered-by");

export const server = http.createServer(app);
// Game messages are tiny, so refuse anything over 1 KB instead of parsing it.
export const wss = new WebSocketServer({ server, maxPayload: 1024 });

// Game results live in SQLite via Node's built-in driver (no native add-on to build).
// DB_PATH lets the tests use a throwaway in-memory database (":memory:").
const db = new DatabaseSync(process.env.DB_PATH || "tic_tac_toe.db");
// One row per player (by their secret browser ID), with their online record. The ID
// itself is never sent to anyone; the leaderboard shows only the name made from it.
db.exec(`CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0
)`);
const recordResult = db.prepare(`
    INSERT INTO players (id, name, wins, losses, draws) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        wins = wins + excluded.wins,
        losses = losses + excluded.losses,
        draws = draws + excluded.draws
`);
const selectLeaderboard = db.prepare(`
    SELECT name, wins, losses, draws FROM players
    ORDER BY wins DESC, losses ASC, draws DESC, name ASC
    LIMIT 10
`);

// Every room by its code. Private rooms are joined by typing the code; quick-match
// rooms are public and pair up strangers (their code is never shown).
const rooms = new Map<string, Room>();

// Codes skip look-alike characters (0/O, 1/I/L) so they are easy to read out and type.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

function newRoomCode(): string {
    let code: string;
    do {
        code = "";
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
        }
    } while (rooms.has(code));
    return code;
}

function createRoom(isPrivate: boolean): Room {
    const code = newRoomCode();
    const room: Room = {
        code, isPrivate, players: [],
        board: Game.emptyBoard(), turn: "X", finished: false, rematchVotes: new Set(),
    };
    rooms.set(code, room);
    return room;
}

// Send a message to a client only if its socket is still open.
function safeSend(ws: Player, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

// Put a room back to an empty board with X to move.
function resetRoom(room: Room): void {
    room.board = Game.emptyBoard();
    room.turn = "X";
    room.finished = false;
    room.rematchVotes = new Set();
}

// Seat a player in a room with a free symbol, then wait or start the game.
function addPlayer(ws: Player, room: Room): void {
    // Take whichever symbol is still free (not "first in = X"), so a player who
    // joins after someone left can never end up with the same symbol as the other.
    const taken = room.players.map((player) => player.symbol);
    const symbol: Mark = taken.includes("X") ? "O" : "X";
    room.players.push(ws);
    ws.room = room.code;
    ws.symbol = symbol;
    safeSend(ws, { type: "assign", symbol });

    if (room.players.length < 2) {
        safeSend(ws, { type: "waiting" });
        return;
    }
    startGame(room);
}

// Tell both players the game is on, and who is playing which symbol.
function startGame(room: Room): void {
    const names: Record<Mark, string> = { X: "", O: "" };
    room.players.forEach((player) => {
        if (player.symbol) names[player.symbol] = player.playerName;
    });
    room.players.forEach((player) => safeSend(player, { type: "start", players: names }));
}

// Add a finished game to both players' records. Guests, and games where both seats
// belong to the same browser (two tabs), don't count.
function saveResult(room: Room, winner: Mark | "draw"): void {
    const [a, b] = room.players;
    if (!a.playerId || !b.playerId || a.playerId === b.playerId) return;
    for (const player of room.players) {
        const won = winner === player.symbol ? 1 : 0;
        const lost = winner !== "draw" && winner !== player.symbol ? 1 : 0;
        const drew = winner === "draw" ? 1 : 0;
        recordResult.run(player.playerId, player.playerName, won, lost, drew);
    }
}

// Who this connection is: the browser's secret ID from the request, if it sent a valid
// one. Players without one can still play, as "Guest", but their games aren't ranked.
function identify(ws: Player, data: Incoming): void {
    ws.playerId = Game.isPlayerId(data.player) ? data.player : null;
    ws.playerName = Game.playerName(ws.playerId);
}

// "create": open a private room and tell the creator its code to share.
function handleCreate(ws: Player, data: Incoming): void {
    if (ws.room) return; // one room per connection
    identify(ws, data);
    const room = createRoom(true);
    safeSend(ws, { type: "room", code: room.code });
    addPlayer(ws, room);
}

// "join": take the free seat in a private room, by its code.
function handleJoin(ws: Player, data: Incoming): void {
    if (ws.room) return;
    identify(ws, data);
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
function handleQuickMatch(ws: Player, data: Incoming): void {
    if (ws.room) return;
    identify(ws, data);
    const room = [...rooms.values()].find((r) => !r.isPrivate && r.players.length === 1)
        ?? createRoom(false);
    addPlayer(ws, room);
}

// Apply one validated move, then broadcast the new state or the game result.
function handleMove(ws: Player, data: Incoming): void {
    // The move is only trusted for the room and symbol the SERVER assigned to
    // this connection - never the ones claimed in the message - so a client
    // cannot move for their opponent or into a room they never joined.
    const room = ws.room ? rooms.get(ws.room) : undefined;
    if (!room || !ws.symbol || !room.players.includes(ws)) return;
    if (room.finished) return;                      // game over, waiting for a rematch
    if (room.players.length < 2) return;            // no solo play before an opponent joins
    if (room.turn !== ws.symbol) return;            // not this player's turn

    // Validate the cell index and make sure it's empty.
    const index = data.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 8) return;
    if (room.board[index] !== "") return;

    room.board[index] = ws.symbol;
    room.turn = Game.otherSymbol(room.turn);

    // Check for a win or draw with the shared rules (the same code the browser uses)
    const result = Game.getResult(room.board);
    if (result) {
        try {
            saveResult(room, result.winner);
        } catch (err) {
            console.error("Error saving game result:", (err as Error).message);
        }

        // Send the final board first, then the result, so the result message
        // is the last thing each client renders.
        room.players.forEach((player) => {
            safeSend(player, { type: "update", board: room.board, turn: null });
            safeSend(player, { type: "game_over", winner: result.winner, winning_combination: result.line });
        });

        // Keep both players in the room so they can ask for a rematch. The room is
        // freed when they leave (see the close handler).
        room.finished = true;
        return;
    }

    room.players.forEach((player) => {
        safeSend(player, { type: "update", board: room.board, turn: room.turn });
    });
}

// A finished game restarts once both players ask for a rematch. They swap
// symbols, so whoever went second last game starts as X (X always moves first).
function handleRematch(ws: Player): void {
    const room = ws.room ? rooms.get(ws.room) : undefined;
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
        const symbol = Game.otherSymbol(player.symbol ?? "O");
        player.symbol = symbol;
        safeSend(player, { type: "assign", symbol });
    });
    startGame(room);
}

// Ping every player regularly. Hosting proxies close connections that sit idle, and a
// player whose network drops never sends a close frame, so their seat would stay taken.
// Anyone who didn't answer the previous ping is disconnected, which frees the seat.
const HEARTBEAT_MS = 30000;
export function checkConnections(): void {
    wss.clients.forEach((socket) => {
        const ws = socket as Player;
        if (!ws.isAlive) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}
const heartbeat = setInterval(checkConnections, HEARTBEAT_MS);
heartbeat.unref(); // never keep the process alive on its own
wss.on("close", () => clearInterval(heartbeat));

wss.on("connection", (socket) => {
    const ws = socket as Player;
    ws.playerId = null;
    ws.playerName = Game.playerName(null);
    ws.isAlive = true;
    ws.on("pong", () => {
        ws.isAlive = true;
    });

    // Socket-level errors (like an oversized message) close that connection. Without a
    // listener, Node would treat them as uncaught and take the whole server down.
    ws.on("error", (err) => {
        console.error("Connection error:", err.message);
    });

    ws.on("message", (raw) => {
        // A malformed frame must never take the server down.
        let data: unknown;
        try {
            data = JSON.parse(String(raw));
        } catch {
            return;
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) return;
        const message = data as Incoming;

        try {
            if (message.type === "create") handleCreate(ws, message);
            if (message.type === "join") handleJoin(ws, message);
            if (message.type === "quick") handleQuickMatch(ws, message);
            if (message.type === "move") handleMove(ws, message);
            if (message.type === "rematch") handleRematch(ws);
        } catch (err) {
            console.error("Error handling message:", (err as Error).message);
        }
    });

    // When a player disconnects, free their seat. Whoever is left gets a fresh
    // board and waits for a new opponent as X, instead of keeping the old,
    // half-played game (which a newcomer would then have joined mid-way).
    ws.on("close", () => {
        const room = ws.room ? rooms.get(ws.room) : undefined;
        if (!room) return;

        room.players = room.players.filter((player) => player !== ws);
        const remaining = room.players[0];
        if (!remaining) {
            rooms.delete(room.code);
            return;
        }

        resetRoom(room);
        remaining.symbol = "X";
        safeSend(remaining, { type: "opponent_left" });
        safeSend(remaining, { type: "assign", symbol: "X" });
    });
});

// The page itself, so one server hosts everything. Only these three folders are
// public: the page and its stylesheet, and the compiled browser code. Server code, the
// database and package files are never served.
const COMPILED = path.resolve(import.meta.dirname, "..");   // dist/src
app.use(express.static(path.resolve(COMPILED, "../../public")));
app.use("/client", express.static(path.join(COMPILED, "client")));
app.use("/shared", express.static(path.join(COMPILED, "shared")));

// The top 10 players by wins (then fewest losses). Names and records only, never IDs.
app.get("/leaderboard", (_req, res) => {
    try {
        res.json(selectLeaderboard.all() as unknown as LeaderboardRow[]);
    } catch (err) {
        console.error("Error reading leaderboard:", (err as Error).message);
        res.status(500).json({ error: "Could not load the leaderboard" });
    }
});
