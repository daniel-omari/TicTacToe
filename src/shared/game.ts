// Pure Tic-Tac-Toe rules, AI and player names, shared by the browser client, the Node
// server and the tests. Nothing here touches the page or the network, so every function
// can be unit tested on its own. The board is an array of 9 cells in reading order (0-8).

export type Mark = "X" | "O";
export type Cell = Mark | "";
export type Board = Cell[];
export type Difficulty = "naive" | "intermediate" | "advanced" | "unbeatable";
export type Rng = () => number;

// The game's outcome: three in a row (with the winning line), or a full board
export type Result =
    | { winner: Mark; line: number[] }
    | { winner: "draw"; line: [] };

// Every line that wins the game, as board indices
export const WINNING_LINES: readonly (readonly number[])[] = Object.freeze([
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6],            // diagonals
]);

export const DIFFICULTIES: readonly Difficulty[] = Object.freeze(
    ["naive", "intermediate", "advanced", "unbeatable"] as const,
);

export const isDifficulty = (value: unknown): value is Difficulty =>
    DIFFICULTIES.includes(value as Difficulty);

export const otherSymbol = (symbol: Mark): Mark => (symbol === "X" ? "O" : "X");

export function emptyBoard(): Board {
    return Array<Cell>(9).fill("");
}

// Indices of the cells nobody has played yet
export function emptyCells(board: readonly Cell[]): number[] {
    const cells: number[] = [];
    board.forEach((cell, index) => {
        if (cell === "") cells.push(index);
    });
    return cells;
}

// The game's outcome so far, or null while it is still in progress
export function getResult(board: readonly Cell[]): Result | null {
    for (const line of WINNING_LINES) {
        const [a, b, c] = line;
        const mark = board[a];
        if (mark && mark === board[b] && mark === board[c]) {
            return { winner: mark, line: [...line] };
        }
    }
    if (board.every((cell) => cell !== "")) return { winner: "draw", line: [] };
    return null;
}

// Minimax with alpha-beta pruning, scored from aiSymbol's point of view. Faster wins
// and slower losses score higher, so the AI finishes quickly and resists longest.
// Plays moves in place and undoes them, instead of copying the board at every node.
// maxDepth limits how far ahead it looks; positions past that count as 0 (unknown).
function minimax(
    board: Board, depth: number, isAiTurn: boolean,
    alpha: number, beta: number, aiSymbol: Mark, maxDepth: number,
): number {
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
export function bestMoves(board: readonly Cell[], aiSymbol: Mark, maxDepth = Infinity): number[] {
    const work = [...board]; // never mutate the caller's board
    let moves: number[] = [];
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
function pick(list: readonly number[], rng: Rng): number {
    return list.length ? list[Math.floor(rng() * list.length)] : -1;
}

// One of the best moves for aiSymbol, ties broken at random so games don't repeat.
// Returns -1 if the board is full.
export function bestMove(board: readonly Cell[], aiSymbol: Mark, rng: Rng = Math.random, maxDepth = Infinity): number {
    return pick(bestMoves(board, aiSymbol, maxDepth), rng);
}

// A random empty cell, or -1 if the board is full
export function randomMove(board: readonly Cell[], rng: Rng = Math.random): number {
    return pick(emptyCells(board), rng);
}

// Cells where symbol would complete a line right now
export function winningMoves(board: readonly Cell[], symbol: Mark): number[] {
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
function strongSquares(candidates: number[]): number[] {
    const strong = candidates.filter((index) => [0, 2, 4, 6, 8].includes(index));
    return strong.length ? strong : candidates;
}

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
export function aiMove(board: readonly Cell[], difficulty: Difficulty, aiSymbol: Mark, rng: Rng = Math.random): number {
    if (getResult(board)) return -1; // the game is already over

    if (difficulty === "naive") {
        return rng() < 0.6 ? bestMove(board, aiSymbol, rng) : randomMove(board, rng);
    }
    if (difficulty === "unbeatable") return bestMove(board, aiSymbol, rng);
    if (difficulty !== "intermediate" && difficulty !== "advanced") {
        // The type rules this out, but values can still arrive from outside at runtime
        throw new Error(`Unknown difficulty: ${String(difficulty)}`);
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

export const isPlayerId = (id: unknown): id is string =>
    typeof id === "string" && PLAYER_ID_PATTERN.test(id);

// "Swift Otter 42" for an ID; the first three bytes pick the words and the number
export function playerName(id: unknown): string {
    if (!isPlayerId(id)) return "Guest";
    const byte = (i: number) => parseInt(id.slice(i * 2, i * 2 + 2), 16);
    const adjective = NAME_ADJECTIVES[byte(0) % NAME_ADJECTIVES.length];
    const animal = NAME_ANIMALS[byte(1) % NAME_ANIMALS.length];
    return `${adjective} ${animal} ${10 + (byte(2) % 90)}`;
}
