"use strict";
document.addEventListener("DOMContentLoaded", () => {

    // ---- State ----
    // Everything the game screen shows lives in this one object. Event handlers
    // update it and then call render(); nothing else writes to the board in the page.
    const state = {
        mode: null,           // "offline", "ai" or "online" (null = still on the menu)
        board: TicTacToeGame.emptyBoard(),
        turn: "X",            // whose move it is
        active: true,         // false before an online game starts and once a game is over
        result: null,         // TicTacToeGame.getResult() once the game is over
        notice: null,         // one-off status message shown instead of "Player X's turn"
        aiDifficulty: "easy",
        symbol: null,         // online only: the symbol the server gave us
        rematch: "hidden",    // online only: "hidden", "available" or "requested"
    };

    const ONLINE_ROOM = "gameRoom";
    let aiTimer = null; // pending AI move, so a reset or leaving the game can cancel it
    let ws = null;      // connection to the game server while in online mode

    // Elements
    const menuScreen = document.getElementById("menu-screen");
    const gameContainer = document.getElementById("game-container");
    const squares = document.querySelectorAll(".square");
    const statusText = document.getElementById("status");
    const resetButton = document.getElementById("reset");
    const menuButton = document.getElementById("menu");
    const rematchButton = document.getElementById("rematch");
    const playerIndicator = document.getElementById("playerIndicator");
    const endGameMessage = document.getElementById("endGameMessage");
    const offlineButton = document.getElementById("offline");
    const onlineButton = document.getElementById("online");
    const leaderboardButton = document.getElementById("viewLeaderboard");
    const leaderboardScreen = document.getElementById("leaderboard");
    const leaderboardList = document.getElementById("leaderboardList");
    const leaderboardBackButton = document.getElementById("leaderboardBack");
    const aiButton = document.getElementById("ai");
    const aiModeSelection = document.getElementById("ai-mode-selection");
    const easyButton = document.getElementById("aiEasy");
    const mediumButton = document.getElementById("aiMedium");
    const impossibleButton = document.getElementById("aiHard");
    const aiBackButton = document.getElementById("aiBack");

    // ---- Rendering ----

    // Draw the game screen from state. Safe to call any number of times.
    function render() {
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
        if (state.result) {
            endGameMessage.textContent = state.result.winner === "draw"
                ? "It's a draw!"
                : `Player ${state.result.winner} WINS!`;
        }

        playerIndicator.textContent = state.mode === "online" && state.symbol
            ? `You are player: ${state.symbol}`
            : "";
        resetButton.hidden = state.mode === "online"; // online games restart with Rematch instead
        rematchButton.hidden = state.rematch === "hidden";
        rematchButton.disabled = state.rematch === "requested";
    }

    // The line under the board: a one-off notice, the result, or whose turn it is
    function statusMessage() {
        if (state.notice) return state.notice;
        if (state.result) {
            return state.result.winner === "draw" ? "It's a draw!" : `Player ${state.result.winner} wins!`;
        }
        return `Player ${state.turn}'s turn`;
    }

    // What a screen reader announces for one cell, e.g. "Cell 5, X, winning line"
    function cellLabel(index, mark, winning) {
        const label = `Cell ${index + 1}, ${mark || "empty"}`;
        return winning ? `${label}, winning line` : label;
    }

    // ---- Screens ----

    // Colour theme for each mode (null = plain menu look)
    function applyTheme(theme) {
        document.body.classList.remove("offline-theme", "ai-theme", "online-theme");
        if (theme) document.body.classList.add(`${theme}-theme`);
    }

    function switchToGame() {
        menuScreen.style.display = "none";
        aiModeSelection.style.display = "none";
        gameContainer.style.display = "flex";
    }

    // Show the main menu (hiding every other screen) and move keyboard focus into it
    function showMenu(focusTarget) {
        aiModeSelection.style.display = "none";
        leaderboardScreen.style.display = "none";
        gameContainer.style.display = "none";
        menuScreen.style.display = ""; // back to its stylesheet layout
        applyTheme(null);
        focusTarget.focus();
    }

    function showAiMenu() {
        applyTheme("ai");
        menuScreen.style.display = "none";
        aiModeSelection.style.display = "flex";
        easyButton.focus();
    }

    // ---- Game flow (offline and AI) ----

    // Put the state back to an empty board with X to move. Callers render afterwards.
    function resetBoard() {
        clearTimeout(aiTimer); // drop an AI move still waiting from the previous game
        state.board = TicTacToeGame.emptyBoard();
        state.turn = "X";
        state.active = true;
        state.result = null;
        state.notice = null;
        state.rematch = "hidden";
    }

    // The Reset button, and the start of every offline or AI game
    function restartGame() {
        resetBoard();
        render();
        squares[0].focus();
    }

    function startOfflineGame() {
        state.mode = "offline";
        applyTheme("offline");
        switchToGame();
        restartGame();
    }

    function startAIGame(difficulty) {
        state.mode = "ai";
        state.aiDifficulty = difficulty;
        switchToGame();
        restartGame();
    }

    // A player clicked a cell (buttons also click on Enter and Space)
    function handleCellChoice(index) {
        if (!state.active || state.board[index] !== "") return;
        if (state.mode === "online") {
            sendOnlineMove(index);
            return;
        }
        if (state.mode === "ai" && state.turn === "O") return; // the AI is still thinking

        placeMark(index);
        if (state.mode === "ai" && state.active) {
            aiTimer = setTimeout(playAiTurn, 500); // short pause so the AI feels like it's thinking
        }
    }

    // Place the current player's mark, then end the game or pass the turn
    function placeMark(index) {
        state.board[index] = state.turn;
        state.result = TicTacToeGame.getResult(state.board);
        if (state.result) state.active = false;
        else state.turn = TicTacToeGame.otherSymbol(state.turn);
        render();
    }

    function playAiTurn() {
        const move = TicTacToeGame.aiMove(state.board, state.aiDifficulty, "O");
        if (move !== -1) placeMark(move);
    }

    // Arrow keys move focus around the board, stopping at the edges
    function handleArrowKeys(event, index) {
        if (event.key === "ArrowDown" && index < 6) squares[index + 3].focus();
        if (event.key === "ArrowUp" && index > 2) squares[index - 3].focus();
        if (event.key === "ArrowRight" && index % 3 !== 2) squares[index + 1].focus();
        if (event.key === "ArrowLeft" && index % 3 !== 0) squares[index - 1].focus();
    }

    // Leave the current game and go back to the main menu, clearing all mode state
    function returnToMenu() {
        if (ws) { // leaving an online game: stop listening, and closing tells the server we left
            ws.onmessage = null;
            ws.onclose = null;
            ws.close();
            ws = null;
        }
        state.mode = null;
        state.symbol = null;
        resetBoard(); // also cancels a pending AI move
        render();
        showMenu(aiButton);
    }

    // ---- Online mode ----

    function startOnlineGame() {
        state.mode = "online";
        state.symbol = null;
        resetBoard();
        state.active = false; // no moves until an opponent joins
        state.notice = "Searching for an opponent...";
        applyTheme("online");
        switchToGame();
        render();

        ws = new WebSocket("ws://localhost:3000");

        let connected = false;
        ws.onopen = () => {
            connected = true;
            ws.send(JSON.stringify({ type: "join", room: ONLINE_ROOM }));
        };

        // Without this a dead or unreachable server would leave the page "searching" forever
        ws.onclose = () => {
            if (state.mode !== "online") return; // we left on purpose via the Menu button
            state.active = false;
            state.rematch = "hidden";
            state.notice = connected
                ? "Lost connection to the game server."
                : "Couldn't reach the game server. Is it running?";
            render();
        };

        ws.onmessage = (event) => {
            handleServerMessage(JSON.parse(event.data));
            render();
        };
    }

    // Apply one server message to the state (render runs after every message)
    function handleServerMessage(data) {
        switch (data.type) {
            case "assign": // our symbol, at the start and again after a rematch swap
                state.symbol = data.symbol;
                break;
            case "waiting":
                state.notice = "Searching for an opponent...";
                break;
            case "start": // first game or a rematch: begin from a clean board
                resetBoard();
                state.notice = state.symbol === "X"
                    ? "Game started! You go first."
                    : "Game started! Your opponent goes first.";
                squares[0].focus();
                break;
            case "update":
                state.board = data.board;
                if (data.turn) state.turn = data.turn; // turn is null once the game is over
                state.notice = null;
                break;
            case "game_over":
                state.result = { winner: data.winner, line: data.winning_combination };
                state.active = false;
                state.notice = null;
                state.rematch = "available";
                break;
            case "rematch_requested":
                state.notice = "Your opponent wants a rematch!";
                break;
            case "full":
                state.active = false;
                state.notice = "Room is full! Try again later.";
                break;
            case "opponent_left": // fresh board while we wait for someone new
                resetBoard();
                state.active = false;
                state.notice = "Your opponent left. Waiting for a new opponent...";
                break;
        }
    }

    function sendOnlineMove(index) {
        if (state.turn !== state.symbol || !ws || ws.readyState !== WebSocket.OPEN) return;
        state.board[index] = state.symbol; // draw our move straight away
        render();
        ws.send(JSON.stringify({ type: "move", room: ONLINE_ROOM, index, symbol: state.symbol }));
    }

    // Ask the server for a rematch; the game restarts once both players have asked
    function requestRematch() {
        if (!ws || state.rematch !== "available") return;
        ws.send(JSON.stringify({ type: "rematch" }));
        state.rematch = "requested";
        state.notice = "Waiting for your opponent to accept the rematch...";
        render();
    }

    // ---- Leaderboard ----

    // Show the screen, then fill it with the online results from the server
    function displayLeaderboard() {
        menuScreen.style.display = "none";
        leaderboardScreen.style.display = "flex";
        leaderboardScreen.setAttribute("tabindex", "-1"); // focusable from script only
        leaderboardScreen.focus();

        fetch("http://localhost:3000/leaderboard")
            .then((response) => response.json())
            .then((rows) => {
                leaderboardList.replaceChildren();
                if (rows.length === 0) {
                    addLeaderboardRow("No online games played yet", "");
                    return;
                }
                rows.filter((row) => row.winner !== "draw").forEach((row) => {
                    addLeaderboardRow(`Player ${row.winner}`, `${row.wins} ${row.wins === 1 ? "win" : "wins"}`);
                });
                const draws = rows.find((row) => row.winner === "draw");
                if (draws) addLeaderboardRow("Draws", String(draws.wins));
            })
            .catch((error) => {
                console.error("Error fetching leaderboard:", error);
                leaderboardList.replaceChildren();
                addLeaderboardRow("Couldn't reach the server", "");
            });
    }

    // One leaderboard line: a label on the left and a value on the right
    function addLeaderboardRow(label, value) {
        const item = document.createElement("li");
        const labelSpan = document.createElement("span");
        const valueSpan = document.createElement("span");
        labelSpan.textContent = label;
        valueSpan.textContent = value;
        item.append(labelSpan, valueSpan);
        leaderboardList.appendChild(item);
    }

    // ---- Event listeners (attached once) ----
    squares.forEach((square, index) => {
        square.addEventListener("click", () => handleCellChoice(index));
        square.addEventListener("keydown", (event) => handleArrowKeys(event, index));
    });

    offlineButton.addEventListener("click", startOfflineGame);
    aiButton.addEventListener("click", showAiMenu);
    easyButton.addEventListener("click", () => startAIGame("easy"));
    mediumButton.addEventListener("click", () => startAIGame("medium"));
    impossibleButton.addEventListener("click", () => startAIGame("impossible"));
    onlineButton.addEventListener("click", startOnlineGame);
    leaderboardButton.addEventListener("click", displayLeaderboard);

    resetButton.addEventListener("click", restartGame);
    menuButton.addEventListener("click", returnToMenu);
    rematchButton.addEventListener("click", requestRematch);
    aiBackButton.addEventListener("click", () => showMenu(aiButton));
    leaderboardBackButton.addEventListener("click", () => showMenu(leaderboardButton));

    render();
});
