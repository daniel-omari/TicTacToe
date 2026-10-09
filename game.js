"use strict";
// Pure Tic-Tac-Toe rules and AI, shared by the browser client, the Node server and the
// tests. Nothing here touches the page or the network, so every function can be unit
// tested on its own. The board is an array of 9 cells in reading order (0-8), each "",
// "X" or "O". Browsers load this with a plain <script> tag (it works straight from
// file://); Node loads it with require().

const TicTacToeGame = (() => {
    // Every line that wins the game, as board indices
    const WINNING_LINES = Object.freeze([
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
        [0, 4, 8], [2, 4, 6],            // diagonals
    ]);

    const otherSymbol = (symbol) => (symbol === "X" ? "O" : "X");

    function emptyBoard() {
        return Array(9).fill("");
    }

    // Indices of the cells nobody has played yet
    function emptyCells(board) {
        const cells = [];
        board.forEach((cell, index) => {
            if (cell === "") cells.push(index);
        });
        return cells;
    }

    // The game's outcome so far:
    //   { winner: "X" or "O", line: [a, b, c] }  three in a row
    //   { winner: "draw", line: [] }            board full, nobody won
    //   null                                    still in progress
    function getResult(board) {
        for (const line of WINNING_LINES) {
            const [a, b, c] = line;
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                return { winner: board[a], line: [...line] };
            }
        }
        if (board.every((cell) => cell !== "")) return { winner: "draw", line: [] };
        return null;
    }

    // Minimax with alpha-beta pruning, scored from aiSymbol's point of view. Faster wins
    // and slower losses score higher, so the AI finishes quickly and resists longest.
    // Plays moves in place and undoes them, instead of copying the board at every node.
    function minimax(board, depth, isAiTurn, alpha, beta, aiSymbol) {
        const result = getResult(board);
        if (result) {
            if (result.winner === aiSymbol) return 10 - depth;
            if (result.winner === "draw") return 0;
            return depth - 10;
        }

        let best = isAiTurn ? -Infinity : Infinity;
        for (const index of emptyCells(board)) {
            board[index] = isAiTurn ? aiSymbol : otherSymbol(aiSymbol);
            const score = minimax(board, depth + 1, !isAiTurn, alpha, beta, aiSymbol);
            board[index] = "";

            if (isAiTurn) {
                best = Math.max(best, score);
                alpha = Math.max(alpha, best);
            } else {
                best = Math.min(best, score);
                beta = Math.min(beta, best);
            }
            if (beta <= alpha) break; // the opponent would never allow this branch
        }
        return best;
    }

    // The strongest move for aiSymbol: a full search, so it never loses. Ties go to the
    // lowest index. Returns -1 if the board is full.
    function bestMove(board, aiSymbol) {
        const work = [...board]; // never mutate the caller's board
        let bestIndex = -1;
        let bestScore = -Infinity;
        for (const index of emptyCells(work)) {
            work[index] = aiSymbol;
            const score = minimax(work, 0, false, -Infinity, Infinity, aiSymbol);
            work[index] = "";
            if (score > bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        }
        return bestIndex;
    }

    // A random empty cell, or -1 if the board is full
    function randomMove(board, rng = Math.random) {
        const cells = emptyCells(board);
        return cells.length ? cells[Math.floor(rng() * cells.length)] : -1;
    }

    // The AI's move for a difficulty:
    //   "easy"       random
    //   "medium"     the best move about 70% of the time, otherwise random
    //   "impossible" always the best move
    // rng can be swapped for a fixed sequence so tests get predictable "randomness".
    function aiMove(board, difficulty, aiSymbol = "O", rng = Math.random) {
        if (difficulty === "easy") return randomMove(board, rng);
        if (difficulty === "medium") {
            return rng() < 0.7 ? bestMove(board, aiSymbol) : randomMove(board, rng);
        }
        return bestMove(board, aiSymbol);
    }

    return Object.freeze({
        WINNING_LINES,
        otherSymbol,
        emptyBoard,
        emptyCells,
        getResult,
        bestMove,
        randomMove,
        aiMove,
    });
})();

// Node (the server and the tests) imports this; in the browser it's a plain global.
if (typeof module !== "undefined" && module.exports) {
    module.exports = TicTacToeGame;
}
