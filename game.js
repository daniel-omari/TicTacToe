"use strict";
// Pure Tic-Tac-Toe rules, AI and player names, shared by the browser client, the Node
// server and the tests. Nothing here touches the page or the network, so every function can be unit
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
    // maxDepth limits how far ahead it looks; positions past that count as 0 (unknown).
    function minimax(board, depth, isAiTurn, alpha, beta, aiSymbol, maxDepth) {
        const result = getResult(board);
        if (result) {
            if (result.winner === aiSymbol) return 10 - depth;
            if (result.winner === "draw") return 0;
            return depth - 10;
        }
        if (depth >= maxDepth) return 0;

        let best = isAiTurn ? -Infinity : Infinity;
        for (const index of emptyCells(board)) {
            board[index] = isAiTurn ? aiSymbol : otherSymbol(aiSymbol);
            const score = minimax(board, depth + 1, !isAiTurn, alpha, beta, aiSymbol, maxDepth);
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

    // Every move that scores best for aiSymbol. Each one is searched with a full
    // alpha-beta window, so the scores are exact and ties are real ties. With no
    // maxDepth this is a full search, and any of these moves is safe to play.
    function bestMoves(board, aiSymbol, maxDepth = Infinity) {
        const work = [...board]; // never mutate the caller's board
        let moves = [];
        let bestScore = -Infinity;
        for (const index of emptyCells(work)) {
            work[index] = aiSymbol;
            const score = minimax(work, 0, false, -Infinity, Infinity, aiSymbol, maxDepth);
            work[index] = "";
            if (score > bestScore) {
                bestScore = score;
                moves = [index];
            } else if (score === bestScore) {
                moves.push(index);
            }
        }
        return moves;
    }

    // A random item from a list, or -1 if the list is empty
    function pick(list, rng) {
        return list.length ? list[Math.floor(rng() * list.length)] : -1;
    }

    // One of the best moves for aiSymbol, ties broken at random so games don't repeat.
    // Returns -1 if the board is full.
    function bestMove(board, aiSymbol, rng = Math.random, maxDepth = Infinity) {
        return pick(bestMoves(board, aiSymbol, maxDepth), rng);
    }

    // A random empty cell, or -1 if the board is full
    function randomMove(board, rng = Math.random) {
        return pick(emptyCells(board), rng);
    }

    // Cells where symbol would complete a line right now
    function winningMoves(board, symbol) {
        const work = [...board];
        return emptyCells(work).filter((index) => {
            work[index] = symbol;
            const won = getResult(work)?.winner === symbol;
            work[index] = "";
            return won;
        });
    }

    // The squares a decent player reaches for first: the centre and the corners. Narrows
    // a list of candidate moves to those, or leaves it alone if it has none.
    function strongSquares(candidates) {
        const strong = candidates.filter((index) => [0, 2, 4, 6, 8].includes(index));
        return strong.length ? strong : candidates;
    }

    const DIFFICULTIES = Object.freeze(["naive", "intermediate", "advanced", "unbeatable"]);

    // The AI's move at each difficulty. The levels differ in what the AI notices, not
    // just in how often it slips:
    //   "naive"         the best move about 60% of the time, otherwise random (so it can
    //                   miss wins and blocks)
    //   "intermediate"  always takes a win, blocks about 80% of the time, otherwise the
    //                   centre or a corner with no lookahead (it walks into forks)
    //   "advanced"      always wins and blocks, and plays the perfect move about 70% of
    //                   the time. Otherwise it overlooks something deeper, like a fork two
    //                   moves away, and plays any move. Never an obvious blunder, but
    //                   beatable from either side, like a strong human.
    //   "unbeatable"    full minimax search, never loses
    // rng can be swapped for a fixed sequence so tests get predictable "randomness".
    function aiMove(board, difficulty, aiSymbol, rng = Math.random) {
        if (getResult(board)) return -1; // the game is already over

        if (difficulty === "naive") {
            return rng() < 0.6 ? bestMove(board, aiSymbol, rng) : randomMove(board, rng);
        }
        if (difficulty === "unbeatable") return bestMove(board, aiSymbol, rng);
        if (difficulty !== "intermediate" && difficulty !== "advanced") {
            throw new Error(`Unknown difficulty: ${difficulty}`);
        }

        const wins = winningMoves(board, aiSymbol);
        if (wins.length) return pick(wins, rng);
        const blocks = winningMoves(board, otherSymbol(aiSymbol));

        if (difficulty === "intermediate") {
            if (blocks.length && rng() < 0.8) return pick(blocks, rng);
            return pick(strongSquares(emptyCells(board)), rng);
        }
        if (blocks.length) return pick(blocks, rng);
        if (rng() < 0.3) return randomMove(board, rng); // missed something this time
        return pick(strongSquares(bestMoves(board, aiSymbol)), rng);
    }

    // ---- Player names for the online leaderboard ----
    // Every browser keeps a random secret ID (32 hex characters). The public name is made
    // from that ID, so names are friendly, never typed in by players (nothing to moderate)
    // and stay the same for as long as the browser keeps its ID.
    const NAME_ADJECTIVES = Object.freeze([
        "Swift", "Calm", "Bold", "Clever", "Brave", "Lucky", "Quiet", "Sly",
        "Sunny", "Witty", "Eager", "Gentle", "Jolly", "Keen", "Mighty", "Nimble",
        "Proud", "Rapid", "Silent", "Steady", "Bright", "Cosmic", "Daring", "Fierce",
        "Golden", "Happy", "Icy", "Loyal", "Noble", "Rusty", "Sneaky", "Wild",
    ]);
    const NAME_ANIMALS = Object.freeze([
        "Otter", "Falcon", "Panda", "Fox", "Tiger", "Koala", "Badger", "Raven",
        "Wolf", "Lynx", "Moose", "Gecko", "Heron", "Bison", "Cobra", "Dingo",
        "Eagle", "Ferret", "Hippo", "Ibis", "Jaguar", "Lemur", "Marten", "Newt",
        "Owl", "Puffin", "Quokka", "Rhino", "Seal", "Toucan", "Walrus", "Yak",
    ]);
    const PLAYER_ID_PATTERN = /^[0-9a-f]{32}$/;

    const isPlayerId = (id) => typeof id === "string" && PLAYER_ID_PATTERN.test(id);

    // "Swift Otter 42" for an ID; the first three bytes pick the words and the number
    function playerName(id) {
        if (!isPlayerId(id)) return "Guest";
        const byte = (i) => parseInt(id.slice(i * 2, i * 2 + 2), 16);
        const adjective = NAME_ADJECTIVES[byte(0) % NAME_ADJECTIVES.length];
        const animal = NAME_ANIMALS[byte(1) % NAME_ANIMALS.length];
        return `${adjective} ${animal} ${10 + (byte(2) % 90)}`;
    }

    return Object.freeze({
        WINNING_LINES,
        otherSymbol,
        emptyBoard,
        emptyCells,
        getResult,
        bestMoves,
        bestMove,
        randomMove,
        winningMoves,
        DIFFICULTIES,
        aiMove,
        isPlayerId,
        playerName,
    });
})();

// Node (the server and the tests) imports this; in the browser it's a plain global.
if (typeof module !== "undefined" && module.exports) {
    module.exports = TicTacToeGame;
}
