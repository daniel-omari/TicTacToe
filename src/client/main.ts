// The browser client. Everything the game screen shows lives in one `state` object;
// event handlers update it and call render(), and nothing else writes to the board.
// Loaded as a module, so it runs once the page has been parsed.

import * as Game from "../shared/game.js";
import type { Board, Difficulty, Mark, Result } from "../shared/game.js";
import type { ClientMessage, LeaderboardRow, ServerMessage } from "../shared/protocol.js";

type Mode = "offline" | "ai" | "online";
type Rematch = "hidden" | "available" | "requested";
// What the online buttons ask the server for (the player ID is added when sending)
type OnlineRequest = Extract<ClientMessage, { type: "quick" | "create" | "join" }>;

interface State {
    mode: Mode | null;          // null = still on the menu
    board: Board;
    turn: Mark;                 // whose move it is
    active: boolean;            // false before an online game starts and once a game is over
    result: Result | null;      // Game.getResult() once the game is over
    notice: string | null;      // one-off status message shown instead of "Your turn"
    aiDifficulty: Difficulty;
    player1: Mark;              // Player 1's symbol (in AI mode, the human). Swaps after every finished game.
    symbol: Mark | null;        // online only: the symbol the server gave us
    roomCode: string | null;    // online only: the private room's code, to show and share
    opponentName: string | null; // online only: the other player's generated name
    rematch: Rematch;           // online only
}

const state: State = {
    mode: null,
    board: Game.emptyBoard(),
    turn: "X",
    active: true,
    result: null,
    notice: null,
    aiDifficulty: "naive",
    player1: "X",
    symbol: null,
    roomCode: null,
    opponentName: null,
    rematch: "hidden",
};

// The server hosts this page, so talk to the same origin (wss:// on https)
const SERVER_WS = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;

// This browser's secret player ID. The public name is made from it (see playerName in
// game.ts), and it is kept in localStorage so name and record survive reloads.
const playerId = loadPlayerId();
const myName = Game.playerName(playerId);

function loadPlayerId(): string {
    const KEY = "tictactoe-player-id";
    try {
        const saved = localStorage.getItem(KEY);
        if (Game.isPlayerId(saved)) return saved;
    } catch {
        // storage blocked (some private modes): a fresh ID for this visit is fine
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    try {
        localStorage.setItem(KEY, id);
    } catch {
        // as above
    }
    return id;
}

let aiTimer: ReturnType<typeof setTimeout> | undefined; // pending AI move, cancelled on reset or leaving
let ws: WebSocket | null = null;                          // connection to the game server while online

// ---- Elements ----

// An element that must exist in index.html (a missing one is a bug, so fail loudly)
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing #${id} in index.html`);
    return element as T;
}

const menuScreen = byId("menu-screen");
const gameContainer = byId("game-container");
const squares = document.querySelectorAll<HTMLButtonElement>(".square");
const statusText = byId("status");
const resetButton = byId<HTMLButtonElement>("reset");
const menuButton = byId<HTMLButtonElement>("menu");
const rematchButton = byId<HTMLButtonElement>("rematch");
const playerIndicator = byId("playerIndicator");
const endGameMessage = byId("endGameMessage");
const offlineButton = byId<HTMLButtonElement>("offline");
const onlineButton = byId<HTMLButtonElement>("online");
const leaderboardButton = byId<HTMLButtonElement>("viewLeaderboard");
const leaderboardScreen = byId("leaderboard");
const leaderboardList = byId<HTMLUListElement>("leaderboardList");
const leaderboardBackButton = byId<HTMLButtonElement>("leaderboardBack");
const aiButton = byId<HTMLButtonElement>("ai");
const aiModeSelection = byId("ai-mode-selection");
const difficultyButtons = document.querySelectorAll<HTMLButtonElement>("[data-difficulty]");
const aiBackButton = byId<HTMLButtonElement>("aiBack");
const onlineModeSelection = byId("online-mode-selection");
const quickMatchButton = byId<HTMLButtonElement>("quickMatch");
const createRoomButton = byId<HTMLButtonElement>("createRoom");
const joinForm = byId<HTMLFormElement>("joinForm");
const roomCodeInput = byId<HTMLInputElement>("roomCode");
const onlineError = byId("onlineError");
const onlineBackButton = byId<HTMLButtonElement>("onlineBack");
const onlineName = byId("onlineName");
const leaderboardName = byId("leaderboardName");

// ---- Rendering ----

// Draw the game screen from state. Safe to call any number of times.
function render(): void {
    const winningLine = state.result ? state.result.line : [];

    squares.forEach((square, index) => {
        const mark = state.board[index];
        const winning = winningLine.includes(index);
        if (square.textContent !== mark) square.textContent = mark;
        square.classList.toggle("x", mark === "X");
        square.classList.toggle("o", mark === "O");
        square.classList.toggle("winning-square", winning);
        square.setAttribute("aria-label", cellLabel(index, mark, winning));
        if (mark) square.setAttribute("aria-disabled", "true");
        else square.removeAttribute("aria-disabled");
    });

    statusText.textContent = statusMessage();

    endGameMessage.style.display = state.result ? "block" : "none";
    if (state.result) endGameMessage.textContent = resultMessage(state.result, true);

    playerIndicator.textContent = playerMessage();
    resetButton.hidden = state.mode === "online"; // online games restart with Rematch instead
    rematchButton.hidden = state.rematch === "hidden";
    rematchButton.disabled = state.rematch === "requested";
}

// The line under the board: a one-off notice, the result, or whose turn it is
function statusMessage(): string {
    if (state.notice) return state.notice;
    if (state.result) return resultMessage(state.result, false);
    if (state.mode === "offline") return `${offlinePlayer(state.turn)}'s turn (${state.turn})`;
    if (state.mode === "ai") return isMe(state.turn) ? "Your turn" : "The AI is thinking...";
    if (state.mode === "online") return isMe(state.turn) ? "Your turn" : `${opponent()}'s turn`;
    return `Player ${state.turn}'s turn`;
}

// Players swap symbols every game, so results name the player, not the symbol.
// shout = true gives the big banner version.
function resultMessage({ winner }: Result, shout: boolean): string {
    if (winner === "draw") return "It's a draw!";
    if (state.mode === "offline") {
        const name = offlinePlayer(winner);
        return shout ? `${name.toUpperCase()} WINS!` : `${name} wins!`;
    }
    if (isMe(winner)) return shout ? "YOU WIN!" : "You win!";
    if (state.mode === "ai") return shout ? "AI WINS!" : "The AI wins!";
    return shout ? "YOU LOSE!" : `${opponent()} wins!`;
}

// Offline, Player 1 holds state.player1's symbol this game
const offlinePlayer = (symbol: Mark) => (symbol === state.player1 ? "Player 1" : "Player 2");
// Whether a symbol belongs to the person at this screen (AI and online modes)
const isMe = (symbol: Mark) => symbol === (state.mode === "online" ? state.symbol : state.player1);
const opponent = () => state.opponentName || "Your opponent";

// The line above the status: who is playing which symbol
function playerMessage(): string {
    if (state.mode === "online") {
        if (!state.symbol) return "";
        const me = `You: ${myName} (${state.symbol})`;
        if (state.opponentName) {
            return `${me} vs ${state.opponentName} (${Game.otherSymbol(state.symbol)})`;
        }
        return state.roomCode ? `${me}, room ${state.roomCode}` : me;
    }
    if (state.mode === "ai") return `You are player: ${state.player1}`;
    if (state.mode === "offline") {
        return `Player 1 is ${state.player1}, Player 2 is ${Game.otherSymbol(state.player1)}`;
    }
    return "";
}

// What a screen reader announces for one cell, e.g. "Cell 5, X, winning line"
function cellLabel(index: number, mark: string, winning: boolean): string {
    const label = `Cell ${index + 1}, ${mark || "empty"}`;
    return winning ? `${label}, winning line` : label;
}

// ---- Screens ----

// Colour theme for each screen (null = plain menu look)
function applyTheme(theme: Mode | "leaderboard" | null): void {
    document.body.classList.remove("offline-theme", "ai-theme", "online-theme", "leaderboard-theme");
    if (theme) document.body.classList.add(`${theme}-theme`);
}

function switchToGame(): void {
    menuScreen.style.display = "none";
    aiModeSelection.style.display = "none";
    onlineModeSelection.style.display = "none";
    gameContainer.style.display = "flex";
}

// Show the main menu (hiding every other screen) and move keyboard focus into it
function showMenu(focusTarget: HTMLElement): void {
    aiModeSelection.style.display = "none";
    onlineModeSelection.style.display = "none";
    leaderboardScreen.style.display = "none";
    gameContainer.style.display = "none";
    menuScreen.style.display = ""; // back to its stylesheet layout
    applyTheme(null);
    focusTarget.focus();
}

function showAiMenu(): void {
    applyTheme("ai");
    menuScreen.style.display = "none";
    aiModeSelection.style.display = "flex";
    difficultyButtons[0]?.focus();
}

// The online options: quick match, a private room, or join one by code. An error from
// a failed join (wrong code, full room) is shown under the code box.
function showOnlineMenu(error = ""): void {
    applyTheme("online");
    menuScreen.style.display = "none";
    gameContainer.style.display = "none";
    onlineModeSelection.style.display = "flex";
    onlineError.textContent = error;
    if (error) roomCodeInput.focus();
    else quickMatchButton.focus();
}

// ---- Game flow (offline and AI) ----

// Put the state back to an empty board with X to move. Callers render afterwards.
function resetBoard(): void {
    clearTimeout(aiTimer); // drop an AI move still waiting from the previous game
    state.board = Game.emptyBoard();
    state.turn = "X";
    state.active = true;
    state.result = null;
    state.notice = null;
    state.rematch = "hidden";
}

// The Reset button, and the start of every offline or AI game. After a finished game
// the players swap symbols, so each side takes turns going first (X always starts).
function restartGame(): void {
    if (state.result) state.player1 = Game.otherSymbol(state.player1);
    resetBoard();
    render();
    squares[0].focus();
    scheduleAiTurn(); // the AI opens when it has X
}

function startOfflineGame(): void {
    state.mode = "offline";
    state.player1 = "X";
    applyTheme("offline");
    switchToGame();
    restartGame();
}

function startAIGame(difficulty: Difficulty): void {
    state.mode = "ai";
    state.aiDifficulty = difficulty;
    state.player1 = "X";
    switchToGame();
    restartGame();
}

// In AI mode the computer plays whichever symbol the human doesn't
const aiSymbol = () => Game.otherSymbol(state.player1);

// A player clicked a cell (buttons also click on Enter and Space)
function handleCellChoice(index: number): void {
    if (!state.active || state.board[index] !== "") return;
    if (state.mode === "online") {
        sendOnlineMove(index);
        return;
    }
    if (state.mode === "ai" && state.turn === aiSymbol()) return; // the AI is still thinking

    placeMark(index);
    scheduleAiTurn();
}

// Place the current player's mark, then end the game or pass the turn
function placeMark(index: number): void {
    state.board[index] = state.turn;
    state.result = Game.getResult(state.board);
    if (state.result) state.active = false;
    else state.turn = Game.otherSymbol(state.turn);
    render();
}

// If it's the AI's turn, play after a short pause so it feels like it's thinking
function scheduleAiTurn(): void {
    if (state.mode === "ai" && state.active && state.turn === aiSymbol()) {
        aiTimer = setTimeout(playAiTurn, 500);
    }
}

function playAiTurn(): void {
    const move = Game.aiMove(state.board, state.aiDifficulty, aiSymbol());
    if (move !== -1) placeMark(move);
}

// Arrow keys move focus around the board, stopping at the edges
function handleArrowKeys(event: KeyboardEvent, index: number): void {
    if (event.key === "ArrowDown" && index < 6) squares[index + 3].focus();
    if (event.key === "ArrowUp" && index > 2) squares[index - 3].focus();
    if (event.key === "ArrowRight" && index % 3 !== 2) squares[index + 1].focus();
    if (event.key === "ArrowLeft" && index % 3 !== 0) squares[index - 1].focus();
}

// Stop the current game in any mode and clear all mode state
function leaveGame(): void {
    if (ws) { // leaving an online game: stop listening, and closing tells the server we left
        ws.onmessage = null;
        ws.onclose = null;
        ws.close();
        ws = null;
    }
    state.mode = null;
    state.symbol = null;
    state.roomCode = null;
    state.opponentName = null;
    resetBoard(); // also cancels a pending AI move
    render();
}

// The Menu button: leave the game and go back to the main menu
function returnToMenu(): void {
    leaveGame();
    showMenu(aiButton);
}

// ---- Online mode ----
// The server owns the online board. We only send requests; the board on screen
// changes when the server's "update" message comes back.

function send(socket: WebSocket, message: ClientMessage): void {
    socket.send(JSON.stringify(message));
}

// Connect and send one request: quick match, create a room, or join one by code
function startOnlineGame(request: OnlineRequest): void {
    state.mode = "online";
    state.symbol = null;
    state.roomCode = null;
    state.opponentName = null;
    resetBoard();
    state.active = false; // no moves until an opponent joins
    state.notice = "Connecting...";
    switchToGame();
    render();

    const socket = new WebSocket(SERVER_WS);
    ws = socket;

    let connected = false;
    socket.onopen = () => {
        connected = true;
        send(socket, { ...request, player: playerId });
    };

    // Without this a dead or unreachable server would leave the page "searching" forever
    socket.onclose = () => {
        if (state.mode !== "online") return; // we left on purpose via the Menu button
        state.active = false;
        state.rematch = "hidden";
        state.notice = connected
            ? "Lost connection to the game server."
            : "Couldn't reach the game server. Is it running?";
        render();
    };

    socket.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "not_found" || message.type === "full") { // couldn't join: back to the options
            leaveGame();
            showOnlineMenu(message.type === "full"
                ? "That room already has two players."
                : "No room with that code. Check it and try again.");
            return;
        }
        handleServerMessage(message);
        render();
    };
}

// Apply one server message to the state (render runs after every message). Switching
// on `type` narrows the message, so each case can only use the fields that type has.
function handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
        case "assign": // our symbol, at the start and again after a rematch swap
            state.symbol = message.symbol;
            break;
        case "room": // a private room: its code, to share
            state.roomCode = message.code;
            break;
        case "waiting":
            state.notice = state.roomCode
                ? `Room code: ${state.roomCode}. Send it to a friend; the game starts when they join.`
                : "Searching for an opponent...";
            break;
        case "start": // first game or a rematch: begin from a clean board
            resetBoard();
            state.opponentName = state.symbol ? message.players[Game.otherSymbol(state.symbol)] : null;
            state.notice = state.symbol === "X"
                ? "Game started! You go first."
                : "Game started! Your opponent goes first.";
            squares[0].focus();
            break;
        case "update":
            state.board = message.board;
            if (message.turn) state.turn = message.turn; // turn is null once the game is over
            state.notice = null;
            break;
        case "game_over":
            state.result = message.winner === "draw"
                ? { winner: "draw", line: [] }
                : { winner: message.winner, line: message.winning_combination };
            state.active = false;
            state.notice = null;
            state.rematch = "available";
            break;
        case "rematch_requested":
            state.notice = "Your opponent wants a rematch!";
            break;
        case "opponent_left": // fresh board while we wait for someone new
            resetBoard();
            state.opponentName = null;
            state.active = false;
            state.notice = state.roomCode
                ? `Your opponent left. Room code ${state.roomCode} is still open.`
                : "Your opponent left. Waiting for a new opponent...";
            break;
    }
}

function sendOnlineMove(index: number): void {
    if (state.turn !== state.symbol || !ws || ws.readyState !== WebSocket.OPEN) return;
    send(ws, { type: "move", index });
}

// Ask the server for a rematch; the game restarts once both players have asked
function requestRematch(): void {
    if (!ws || state.rematch !== "available") return;
    send(ws, { type: "rematch" });
    state.rematch = "requested";
    state.notice = "Waiting for your opponent to accept the rematch...";
    render();
}

// ---- Leaderboard ----

// Show the screen, then fill it with the top players from the server
async function displayLeaderboard(): Promise<void> {
    applyTheme("leaderboard");
    menuScreen.style.display = "none";
    leaderboardScreen.style.display = "flex";
    leaderboardScreen.setAttribute("tabindex", "-1"); // focusable from script only
    leaderboardScreen.focus();

    try {
        const response = await fetch("/leaderboard");
        const rows = (await response.json()) as LeaderboardRow[];
        leaderboardList.replaceChildren();
        if (rows.length === 0) {
            addLeaderboardRow("No ranked games yet", "");
            return;
        }
        rows.forEach((row, i) => {
            const mine = row.name === myName;
            const label = `${i + 1}. ${row.name}${mine ? " (you)" : ""}`;
            addLeaderboardRow(label, `${row.wins}W ${row.losses}L ${row.draws}D`, mine);
        });
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        leaderboardList.replaceChildren();
        addLeaderboardRow("Couldn't reach the server", "");
    }
}

// One leaderboard line: a label on the left and a value on the right
function addLeaderboardRow(label: string, value: string, mine = false): void {
    const item = document.createElement("li");
    const labelSpan = document.createElement("span");
    const valueSpan = document.createElement("span");
    labelSpan.textContent = label;
    valueSpan.textContent = value;
    item.append(labelSpan, valueSpan);
    if (mine) item.classList.add("you");
    leaderboardList.appendChild(item);
}

// Your generated name, shown on the online and leaderboard screens
function showMyName(element: HTMLElement, before: string): void {
    const strong = document.createElement("strong");
    strong.textContent = myName;
    element.replaceChildren(before, strong);
}
showMyName(onlineName, "You'll play as ");
showMyName(leaderboardName, "You play online as ");

// ---- Event listeners (attached once) ----
squares.forEach((square, index) => {
    square.addEventListener("click", () => handleCellChoice(index));
    square.addEventListener("keydown", (event) => handleArrowKeys(event, index));
});

offlineButton.addEventListener("click", startOfflineGame);
aiButton.addEventListener("click", showAiMenu);
difficultyButtons.forEach((button) => {
    const difficulty = button.dataset.difficulty;
    if (!Game.isDifficulty(difficulty)) throw new Error(`Unknown difficulty button: ${difficulty}`);
    button.addEventListener("click", () => startAIGame(difficulty));
});
onlineButton.addEventListener("click", () => showOnlineMenu());
quickMatchButton.addEventListener("click", () => startOnlineGame({ type: "quick" }));
createRoomButton.addEventListener("click", () => startOnlineGame({ type: "create" }));
joinForm.addEventListener("submit", (event) => {
    event.preventDefault(); // stay on the page
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code) {
        onlineError.textContent = "Enter a room code first.";
        roomCodeInput.focus();
        return;
    }
    startOnlineGame({ type: "join", code });
});
onlineBackButton.addEventListener("click", () => showMenu(onlineButton));
leaderboardButton.addEventListener("click", () => void displayLeaderboard());

resetButton.addEventListener("click", restartGame);
menuButton.addEventListener("click", returnToMenu);
rematchButton.addEventListener("click", requestRematch);
aiBackButton.addEventListener("click", () => showMenu(aiButton));
leaderboardBackButton.addEventListener("click", () => showMenu(leaderboardButton));

render();
