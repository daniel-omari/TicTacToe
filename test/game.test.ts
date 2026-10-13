// Unit tests for the shared game rules, AI and player names (src/shared/game.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import * as Game from "../src/shared/game.js";
import type { Board, Cell, Difficulty, Mark } from "../src/shared/game.js";

// Build a board from a 9-character string, "." = empty, e.g. "XO.X....."
const boardOf = (cells: string): Board => [...cells].map((c) => (c === "." ? "" : c) as Cell);

// A fake random number generator that returns the given values in order
const sequence = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
};

test("getResult finds every winning line for both players", () => {
    for (const symbol of ["X", "O"] as const) {
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
    assert.equal(Game.getResult(boardOf("XOXOXOOXX"))?.winner, "X");
});

test("getResult returns null while the game is still going", () => {
    assert.equal(Game.getResult(Game.emptyBoard()), null);
    assert.equal(Game.getResult(boardOf("XO..X..O.")), null);
});

test("emptyCells lists exactly the unplayed cells", () => {
    assert.deepEqual(Game.emptyCells(boardOf("X.O.X.O..")), [1, 3, 5, 7, 8]);
    assert.deepEqual(Game.emptyCells(boardOf("XOXXOOOXX")), []);
});

test("bestMoves takes an immediate win", () => {
    // O has 3 and 4 and wins at 5 (X could also win at 2 - winning comes first)
    assert.deepEqual(Game.bestMoves(boardOf("XX.OO.X.."), "O"), [5]);
});

test("bestMoves blocks the opponent's immediate win", () => {
    // X threatens the top row at 2
    assert.deepEqual(Game.bestMoves(boardOf("XX..O...."), "O"), [2]);
});

test("bestMoves returns every equally good move, and bestMove picks one at random", () => {
    // With perfect play every opening move is a draw, so all nine are equally good
    const empty = Game.emptyBoard();
    assert.deepEqual(Game.bestMoves(empty, "X"), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(Game.bestMove(empty, "X", sequence(0)), 0);
    assert.equal(Game.bestMove(empty, "X", sequence(0.99)), 8);
});

test("bestMoves never mutates the board it is given", () => {
    const board = boardOf("X...O....");
    const copy = [...board];
    Game.bestMoves(board, "X");
    Game.winningMoves(board, "X");
    assert.deepEqual(board, copy);
});

test("winningMoves lists every cell that completes a line", () => {
    assert.deepEqual(Game.winningMoves(boardOf("XX.X....."), "X"), [2, 6]);
    assert.deepEqual(Game.winningMoves(boardOf("XX.X....."), "O"), []);
});

test("moves return -1 on a full or finished board", () => {
    const full = boardOf("XOXXOOOXX");
    assert.equal(Game.bestMove(full, "O"), -1);
    assert.equal(Game.randomMove(full), -1);
    for (const difficulty of Game.DIFFICULTIES) {
        assert.equal(Game.aiMove(full, difficulty, "O"), -1);
        assert.equal(Game.aiMove(boardOf("XXXOO...."), difficulty, "O"), -1); // X already won
    }
});

test("an unknown difficulty is an error, not a silent default", () => {
    assert.throws(() => Game.aiMove(Game.emptyBoard(), "impossible" as Difficulty, "X"), /Unknown difficulty/);
});

test("naive plays the best move when its coin flip says so, otherwise random", () => {
    const board = boardOf("XX..O....");                                  // must block at 2
    assert.equal(Game.aiMove(board, "naive", "O", sequence(0.1)), 2);    // 0.1 < 0.6: best move
    assert.equal(Game.aiMove(board, "naive", "O", sequence(0.9, 0.99)), 8); // random: last empty cell
});

test("intermediate always takes a win, whatever the dice say", () => {
    // O can win at 5; X also threatens 2
    assert.equal(Game.aiMove(boardOf("XX.OO.X.."), "intermediate", "O", sequence(0.99)), 5);
});

test("intermediate usually blocks, and otherwise plays the centre or a corner", () => {
    const board = boardOf("XX.......");                                       // X threatens 2
    assert.equal(Game.aiMove(board, "intermediate", "O", sequence(0.5)), 2);  // 0.5 < 0.8: block
    assert.equal(Game.aiMove(board, "intermediate", "O", sequence(0.9)), 8);  // missed it: a corner
    assert.equal(Game.aiMove(boardOf("....X...."), "intermediate", "O", sequence(0.99)), 8); // a corner
});

test("intermediate walks into the opposite-corners fork; advanced usually doesn't", () => {
    // X in opposite corners: a corner reply lets X fork next move, only a side holds.
    const board = boardOf("X...O...X");
    for (const roll of [0, 0.5, 0.99]) {
        assert.ok([2, 6].includes(Game.aiMove(board, "intermediate", "O", sequence(roll))));
        assert.ok([1, 3, 5, 7].includes(Game.aiMove(board, "advanced", "O", sequence(0.5, roll))));
        assert.ok([1, 3, 5, 7].includes(Game.aiMove(board, "unbeatable", "O", sequence(roll))));
    }
    // ...but when advanced slips (a roll under 0.3) it plays any cell, corners included
    assert.equal(Game.aiMove(board, "advanced", "O", sequence(0.1, 0.2)), 2);
});

test("advanced sets up its own fork when it plays well", () => {
    // X to move. Playing 8 threatens both 4 and 5, so O can only block one of them.
    assert.equal(Game.aiMove(boardOf("XOX...O.."), "advanced", "X", sequence(0.5)), 8);
});

// Every position reachable in a real game, with the player to move
function reachablePositions(): { board: Board; toMove: Mark }[] {
    const positions = new Map<string, { board: Board; toMove: Mark }>();
    (function walk(board: Board, toMove: Mark) {
        const key = board.join(",") + toMove;
        if (positions.has(key) || Game.getResult(board)) return;
        positions.set(key, { board: [...board], toMove });
        for (const index of Game.emptyCells(board)) {
            board[index] = toMove;
            walk(board, Game.otherSymbol(toMove));
            board[index] = "";
        }
    })(Game.emptyBoard(), "X");
    return [...positions.values()];
}

test("advanced never misses a win or a block, in any reachable position", () => {
    for (const { board, toMove } of reachablePositions()) {
        const wins = Game.winningMoves(board, toMove);
        const blocks = Game.winningMoves(board, Game.otherSymbol(toMove));
        for (const roll of [0, 0.29, 0.99]) { // includes rolls where it slips
            const move = Game.aiMove(board, "advanced", toMove, sequence(roll));
            if (wins.length) assert.ok(wins.includes(move), `missed a win: ${board.join(",")}`);
            else if (blocks.length) assert.ok(blocks.includes(move), `missed a block: ${board.join(",")}`);
        }
    }
});

// Play out EVERY possible game in which the opponent tries every legal move and the AI
// answers with every one of its equally best moves (each tie it might pick at random),
// and fail if the opponent ever wins. Tic-Tac-Toe is small enough to check exhaustively,
// so this is a proof, not a sample.
function countGamesWhereAiNeverLoses(aiSymbol: Mark): number {
    const opponent = Game.otherSymbol(aiSymbol);
    let games = 0;

    (function play(board: Board, toMove: Mark) {
        const result = Game.getResult(board);
        if (result) {
            assert.notEqual(result.winner, opponent, `AI as ${aiSymbol} lost: ${board.join(",")}`);
            games++;
            return;
        }
        const moves = toMove === aiSymbol ? Game.bestMoves(board, aiSymbol) : Game.emptyCells(board);
        for (const index of moves) {
            board[index] = toMove;
            play(board, Game.otherSymbol(toMove));
            board[index] = "";
        }
    })(Game.emptyBoard(), "X"); // X always moves first

    return games;
}

test("unbeatable never loses as O, in any possible game", () => {
    assert.ok(countGamesWhereAiNeverLoses("O") > 0);
});

test("unbeatable never loses as X, in any possible game", () => {
    assert.ok(countGamesWhereAiNeverLoses("X") > 0);
});

test("player names are made from the browser ID, and anything else is a guest", () => {
    const id = "00010200000000000000000000000000";
    assert.equal(Game.playerName(id), "Swift Falcon 12");     // bytes 00, 01, 02
    assert.equal(Game.playerName(id), Game.playerName(id));   // always the same name
    assert.match(Game.playerName("ffffff" + "0".repeat(26)), /^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/);
    for (const bad of [undefined, null, 42, "", "xyz", "A".repeat(32), id + "0"]) {
        assert.equal(Game.playerName(bad), "Guest");
    }
});
