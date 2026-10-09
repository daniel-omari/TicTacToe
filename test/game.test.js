"use strict";
// Unit tests for the shared game rules and AI (game.js).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Game = require("../game.js");

// Build a board from a 9-character string, "." = empty, e.g. "XO.X....."
const boardOf = (cells) => [...cells].map((c) => (c === "." ? "" : c));

// A fake random number generator that returns the given values in order
const sequence = (...values) => {
    let i = 0;
    return () => values[i++ % values.length];
};

test("getResult finds every winning line for both players", () => {
    for (const symbol of ["X", "O"]) {
        for (const line of Game.WINNING_LINES) {
            const board = Game.emptyBoard();
            line.forEach((index) => (board[index] = symbol));
            assert.deepEqual(Game.getResult(board), { winner: symbol, line });
        }
    }
});

test("getResult reports a draw when the board fills with no line", () => {
    assert.deepEqual(Game.getResult(boardOf("XOXXOOOXX")), { winner: "draw", line: [] });
});

test("a win made with the last move counts as a win, not a draw", () => {
    assert.equal(Game.getResult(boardOf("XOXOXOOXX")).winner, "X");
});

test("getResult returns null while the game is still going", () => {
    assert.equal(Game.getResult(Game.emptyBoard()), null);
    assert.equal(Game.getResult(boardOf("XO..X..O.")), null);
});

test("emptyCells lists exactly the unplayed cells", () => {
    assert.deepEqual(Game.emptyCells(boardOf("X.O.X.O..")), [1, 3, 5, 7, 8]);
    assert.deepEqual(Game.emptyCells(boardOf("XOXXOOOXX")), []);
});

test("bestMove takes an immediate win", () => {
    // O has 3 and 4 and wins at 5 (X could also win at 2 - winning comes first)
    assert.equal(Game.bestMove(boardOf("XX.OO.X.."), "O"), 5);
});

test("bestMove blocks the opponent's immediate win", () => {
    // X threatens the top row at 2
    assert.equal(Game.bestMove(boardOf("XX..O...."), "O"), 2);
});

test("bestMove never mutates the board it is given", () => {
    const board = boardOf("X...O....");
    const copy = [...board];
    Game.bestMove(board, "X");
    assert.deepEqual(board, copy);
});

test("moves return -1 on a full board", () => {
    const full = boardOf("XOXXOOOXX");
    assert.equal(Game.bestMove(full, "O"), -1);
    assert.equal(Game.randomMove(full), -1);
});

test("easy plays a random legal move", () => {
    const board = boardOf("XOX.O.X..");
    assert.equal(Game.aiMove(board, "easy", "O", sequence(0)), 3);       // first empty cell
    assert.equal(Game.aiMove(board, "easy", "O", sequence(0.99)), 8);    // last empty cell
});

test("medium plays the best move when its coin flip says so, otherwise random", () => {
    const board = boardOf("XX..O....");                                  // must block at 2
    assert.equal(Game.aiMove(board, "medium", "O", sequence(0.1)), 2);   // 0.1 < 0.7: best move
    assert.equal(Game.aiMove(board, "medium", "O", sequence(0.9, 0.99)), 8); // random: last empty cell
});

// Play out EVERY possible game in which the opponent tries every legal move and the AI
// always answers with bestMove, and fail if the opponent ever wins. Tic-Tac-Toe is small
// enough to check exhaustively, so this is a proof, not a sample.
function countGamesWhereAiNeverLoses(aiSymbol) {
    const opponent = Game.otherSymbol(aiSymbol);
    let games = 0;

    (function play(board, toMove) {
        const result = Game.getResult(board);
        if (result) {
            assert.notEqual(result.winner, opponent, `AI as ${aiSymbol} lost: ${board.join(",")}`);
            games++;
            return;
        }
        if (toMove === aiSymbol) {
            const move = Game.bestMove(board, aiSymbol);
            board[move] = aiSymbol;
            play(board, opponent);
            board[move] = "";
        } else {
            for (const index of Game.emptyCells(board)) {
                board[index] = opponent;
                play(board, aiSymbol);
                board[index] = "";
            }
        }
    })(Game.emptyBoard(), "X"); // X always moves first

    return games;
}

test("the full-search AI never loses as O, in any possible game", () => {
    assert.ok(countGamesWhereAiNeverLoses("O") > 0);
});

test("the full-search AI never loses as X, in any possible game", () => {
    assert.ok(countGamesWhereAiNeverLoses("X") > 0);
});
