"use strict";
// Integration tests for the game server: a real server on a random free port, real
// WebSocket clients, and a throwaway in-memory database.

process.env.DB_PATH = ":memory:";   // must be set before server.js is loaded
process.env.HEARTBEAT_MS = "100";    // fast pings, so a vanished player is noticed quickly

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { server, wss } = require("../server.js");

let baseUrl;

before(() => new Promise((resolve) => {
    server.listen(0, () => {
        baseUrl = `localhost:${server.address().port}`;
        resolve();
    });
}));

after(() => new Promise((resolve) => {
    wss.clients.forEach((client) => client.terminate());
    wss.close();
    server.close(() => resolve());
}));

// A connected test player that records everything the server sends it
function connect(options) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${baseUrl}`, options);
        ws.messages = [];
        ws.waiters = [];
        ws.symbol = null;
        ws.on("message", (raw) => {
            const message = JSON.parse(raw);
            if (message.type === "assign") ws.symbol = message.symbol;
            ws.messages.push(message);
            ws.waiters = ws.waiters.filter((waiter) => {
                if (waiter.type !== message.type) return true;
                waiter.resolve(message);
                return false;
            });
        });
        ws.on("open", () => resolve(ws));
        ws.on("error", reject);
    });
}

// Resolve with the next message of `type` (call BEFORE triggering it)
function next(ws, type) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for "${type}"`)), 2000);
        ws.waiters.push({ type, resolve: (message) => { clearTimeout(timer); resolve(message); } });
    });
}

const send = (ws, payload) => ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

// Assert that `action` produces no message of `type` for `ws`
async function expectNo(ws, type, action) {
    const before = ws.messages.length;
    await action();
    await pause();
    assert.ok(!ws.messages.slice(before).some((m) => m.type === type), `unexpected "${type}"`);
}

// A player who has created a private room. Resolves with [player, code].
async function createRoom() {
    const player = await connect();
    const room = next(player, "room");
    const waiting = next(player, "waiting");
    send(player, { type: "create" });
    const { code } = await room;
    await waiting;
    return [player, code];
}

// Two players in a fresh private room, game started. Returns [x, o, code].
async function startGame() {
    const [first, code] = await createRoom();
    const second = await connect();
    const started = Promise.all([next(first, "start"), next(second, "start")]);
    send(second, { type: "join", code });
    await started;
    return first.symbol === "X" ? [first, second, code] : [second, first, code];
}

// Make a move and wait for the opponent to see the resulting board
async function move(player, opponent, index) {
    const update = next(opponent, "update");
    send(player, { type: "move", index });
    return update;
}

test("creating a room gives a shareable code, and joining with it starts the game", async () => {
    const [host, code] = await createRoom();
    assert.match(code, /^[A-HJKMNP-Z2-9]{5}$/); // no look-alike characters

    const guest = await connect();
    const told = next(guest, "room");
    const started = Promise.all([next(host, "start"), next(guest, "start")]);
    send(guest, { type: "join", code: ` ${code.toLowerCase()} ` }); // typed loosely
    assert.equal((await told).code, code);
    await started;
    assert.deepEqual([host.symbol, guest.symbol], ["X", "O"]);
    host.close(); guest.close();
});

test("joining a code that doesn't exist is refused", async () => {
    const player = await connect();
    for (const code of ["ZZZZZ", "", 42, null]) {
        const refused = next(player, "not_found");
        send(player, { type: "join", code });
        await refused;
    }
    player.close();
});

test("quick match pairs two waiting players, and never joins a private room", async () => {
    const [host] = await createRoom();                      // private: must be skipped

    const first = await connect();
    const waiting = next(first, "waiting");
    send(first, { type: "quick" });
    await waiting;

    const second = await connect();
    const started = Promise.all([next(first, "start"), next(second, "start")]);
    await expectNo(host, "start", async () => {
        send(second, { type: "quick" });
        await started;
    });
    assert.deepEqual([first.symbol, second.symbol], ["X", "O"]);

    const update = await move(first, second, 4);            // they really share a board
    assert.equal(update.board[4], "X");
    host.close(); first.close(); second.close();
});

test("one connection can only be in one room", async () => {
    const [x, o] = await startGame();
    await expectNo(x, "room", async () => {
        send(x, { type: "create" });
        send(x, { type: "quick" });
    });
    const update = await move(x, o, 0);                     // still playing the same game
    assert.equal(update.board[0], "X");
    x.close(); o.close();
});

test("two players get different symbols and both are told the game started", async () => {
    const [x, o] = await startGame();
    assert.equal(x.symbol, "X");
    assert.equal(o.symbol, "O");
    x.close(); o.close();
});

test("a legal move is applied and broadcast to both players", async () => {
    const [x, o] = await startGame();
    const update = await move(x, o, 4);
    assert.equal(update.board[4], "X");
    assert.equal(update.turn, "O");
    x.close(); o.close();
});

test("illegal and tampered moves are rejected", async () => {
    const [x, o] = await startGame();
    await expectNo(x, "update", async () => {
        send(o, { type: "move", index: 0 });                // out of turn
        send(o, { type: "move", index: 0, symbol: "X" });   // claiming the other symbol
        send(x, { type: "move", index: 9 });                // off the board
        send(x, { type: "move", index: -1 });
        send(x, { type: "move", index: "4" });              // not a number
        send(x, { type: "move", index: 1.5 });
    });
    await move(x, o, 4);
    await expectNo(o, "update", async () => {
        send(o, { type: "move", index: 4 });                // cell already taken
    });
    x.close(); o.close();
});

test("malformed messages don't crash the server", async () => {
    const [x, o] = await startGame();
    send(x, "this is not JSON");
    send(x, "null");
    send(x, "[1, 2, 3]");
    const update = await move(x, o, 0);                     // still works afterwards
    assert.equal(update.board[0], "X");
    x.close(); o.close();
});

test("the game ends with a win, and later moves are ignored", async () => {
    const [x, o] = await startGame();
    await move(x, o, 0); await move(o, x, 3);
    await move(x, o, 1); await move(o, x, 4);
    const over = next(o, "game_over");
    send(x, { type: "move", index: 2 });                    // X completes the top row
    const result = await over;
    assert.equal(result.winner, "X");
    assert.deepEqual(result.winning_combination, [0, 1, 2]);
    await expectNo(x, "update", async () => send(o, { type: "move", index: 8 }));
    x.close(); o.close();
});

test("a third player is refused while the room is in use", async () => {
    const [x, o, code] = await startGame();
    const third = await connect();
    const full = next(third, "full");
    send(third, { type: "join", code });
    await full;
    x.close(); o.close(); third.close();
});

test("when a player leaves mid-game, the other gets a fresh board and the newcomer the free symbol", async () => {
    const [x, o, code] = await startGame();
    await move(x, o, 4);

    const left = next(o, "opponent_left");
    x.close();
    await left;
    assert.equal(o.symbol, "X", "the remaining player becomes X");

    const newcomer = await connect();
    const started = next(newcomer, "start");
    send(newcomer, { type: "join", code });
    await started;
    assert.equal(newcomer.symbol, "O", "no duplicate symbol");

    const update = await move(o, newcomer, 0);              // fresh board: only this move
    assert.deepEqual(update.board.filter(Boolean), ["X"]);
    o.close(); newcomer.close();
});

test("a rematch starts once both players ask, with symbols swapped", async () => {
    const [x, o] = await startGame();
    await move(x, o, 0); await move(o, x, 3);
    await move(x, o, 1); await move(o, x, 4);
    const over = next(o, "game_over");
    send(x, { type: "move", index: 2 });
    await over;

    const asked = next(o, "rematch_requested");
    send(x, { type: "rematch" });
    await asked;

    const restarted = Promise.all([next(x, "start"), next(o, "start")]);
    send(o, { type: "rematch" });
    await restarted;
    assert.equal(x.symbol, "O", "last game's X now plays O");
    assert.equal(o.symbol, "X", "last game's O now starts as X");

    await expectNo(o, "update", async () => send(x, { type: "move", index: 4 })); // new O can't start
    const update = await move(o, x, 4);
    assert.deepEqual(update.board.filter(Boolean), ["X"]);  // fresh board
    x.close(); o.close();
});

test("the leaderboard endpoint returns the recorded results", async () => {
    const [x, o] = await startGame();
    await move(x, o, 0); await move(o, x, 3);
    await move(x, o, 1); await move(o, x, 4);
    const over = next(o, "game_over");
    send(x, { type: "move", index: 2 });
    await over;

    const response = await fetch(`http://${baseUrl}/leaderboard`);
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.ok(rows.some((row) => row.winner === "X" && row.wins >= 1));
    x.close(); o.close();
});

test("the server hosts the game page, and nothing else from the project folder", async () => {
    const page = await fetch(`http://${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Tic-Tac-Toe<\/title>/);

    for (const file of ["game.js", "ticTacToe.js", "styles.css"]) {
        assert.equal((await fetch(`http://${baseUrl}/${file}`)).status, 200, file);
    }
    for (const file of ["server.js", "package.json", "tic_tac_toe.db", ".gitignore", "test/server.test.js"]) {
        assert.equal((await fetch(`http://${baseUrl}/${file}`)).status, 404, file);
    }
});

test("a player who vanishes without closing (no ping replies) loses their seat", async () => {
    const [host, code] = await createRoom();
    const ghost = await connect({ autoPong: false });       // like a dropped network: goes silent
    const started = next(host, "start");
    send(ghost, { type: "join", code });
    await started;

    const left = next(host, "opponent_left");               // after a missed ping or two
    await left;
    assert.equal(host.symbol, "X");
    host.close();
});

test("oversized messages are refused", async () => {
    const player = await connect();
    const closed = new Promise((resolve) => player.on("close", (code) => resolve(code)));
    send(player, { type: "join", code: "A".repeat(2000) });
    assert.equal(await closed, 1009);                       // 1009 = message too big
});
