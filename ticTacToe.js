"use strict";
document.addEventListener("DOMContentLoaded", () => {

    let board = ["", "", "", "", "", "", "", "", ""]; // represents the 3x3 board
    let currentPlayer = 'X';
    let gameActive = true;
    let mode = null; // "offline", "ai" or "online" (null = still on the menu)
    let winner = null;
    let aiDifficulty = "easy"; // default AI difficulty
    let aiTimer = null; // pending AI move, so a reset or leaving the game can cancel it
    let ws = null;
    let symbol = null;
    let currentRoom;

    // Elements
    const menuScreen = document.getElementById("menu-screen");
    const gameContainer = document.getElementById("game-container");
    const offlineButton = document.getElementById("offline");
    const squares = document.querySelectorAll('.square');
    const statusText = document.getElementById('status');
    const resetButton = document.getElementById('reset');
    const menuButton = document.getElementById('menu');
    const rematchButton = document.getElementById('rematch');
    const playerIndicator = document.getElementById("playerIndicator");
    const endGameMessage = document.getElementById("endGameMessage");
    const leaderboardButton = document.getElementById("viewLeaderboard");
    const leaderboardScreen = document.getElementById("leaderboard");
    const leaderboardList = document.getElementById("leaderboardList");
    const leaderboardBackButton = document.getElementById("leaderboardBack");

    // AI buttons
    const aiButton = document.getElementById("ai");
    const easyButton = document.getElementById("aiEasy");
    const mediumButton = document.getElementById("aiMedium");
    const impossibleButton = document.getElementById("aiHard");
    const aiModeSelection = document.getElementById("ai-mode-selection");
    const aiBackButton = document.getElementById("aiBack");

    easyButton.addEventListener("click", () => startAIGame("easy"));
    mediumButton.addEventListener("click", () => startAIGame("medium"));
    impossibleButton.addEventListener("click", () => startAIGame("impossible"));

    // Online mode buttons
    const onlineButton = document.getElementById("online");
    leaderboardButton.addEventListener("click", () => displayLeaderboard());
    onlineButton.addEventListener("click", () => startOnlineGame());

    // Colour themes for each mode
    function applyTheme(theme){
        document.body.classList.remove("offline-theme", "ai-theme", "online-theme");
        if (theme) document.body.classList.add(`${theme}-theme`); // null = plain menu look
    }
    document.getElementById("offline").addEventListener("click", () => applyTheme("offline"));
    document.getElementById("ai").addEventListener("click", () => applyTheme("ai"));
    document.getElementById("online").addEventListener("click", () => applyTheme("online"));

    function switchToGame() {
        menuScreen.style.display = "none";
        aiModeSelection.style.display = "none";
        gameContainer.style.display = "flex";
    }

    // Offline PvP mode (hide UI move to PVP gamescreen)
    offlineButton.addEventListener("click", () => {
        mode = "offline";
        switchToGame(); 
        resetGame();
    });

    // AI mode selection
    aiButton.addEventListener("click", () => {
        menuScreen.style.display = "none";
        aiModeSelection.style.display = "flex";
        easyButton.focus();
    });

    // Check the board with the shared rules and show the result. Returns true if the game is over.
    function checkWinner() {
        const result = TicTacToeGame.getResult(board);
        if (!result) return false;

        gameActive = false;
        if (result.winner === "draw") {
            statusText.textContent = "It's a draw!";
            showEndGameMessage("It's a draw!");
        } else {
            winner = result.winner;
            result.line.forEach((index) => document.getElementById(index).classList.add("winning-square"));
            showEndGameMessage(`Player ${winner} WINS!`);
            statusText.textContent = `Player ${winner} wins!`;
        }
        statusText.setAttribute("aria-live", "assertive"); // announce the result
        return true;
    }

    // Function to show the winner or draw message
    function showEndGameMessage(message) {
        endGameMessage.textContent = message;
        endGameMessage.style.display = 'block';
    }

    // Handle a player's move
    function makeMove(event, index) {
        if (board[index] !== "" || gameActive === false) {
            return; // prevents moves after game has ended
        }

        // Ignore clicks while the AI is thinking
        if (mode === "ai" && currentPlayer === "O") {
            return;
        }

        if (mode === "online") { 
            onlineMove(index); 
            return; 
        }

        // Offline mode - player's move
        board[index] = currentPlayer;
        event.target.textContent = currentPlayer;
        event.target.classList.add(currentPlayer.toLowerCase());

        event.target.setAttribute("aria-label", `Cell ${index}, ${currentPlayer}`); // announce move via aria label
        event.target.setAttribute("aria-disabled", "true"); // prevent further interaction

        if (checkWinner() === true) { // check for win or draw after player's move
            return;
        }

        currentPlayer = currentPlayer === 'X' ? 'O' : 'X'; // switch to the other player
        statusText.textContent = `Player ${currentPlayer}'s turn`;

        // Announce status update for screen readers
        statusText.setAttribute("aria-live", "polite");

        if (mode === "ai" && currentPlayer === "O") { // AI moves only if AI mode is active and it's AI's turn
            aiTimer = setTimeout(playAiTurn, 500); // short pause so the AI feels like it's thinking
        }
    }

    // Accessibility: handle keyboard input
    function handleKeyPress(event, square, index) {
        if (event.key === "Enter" || event.key === " ") {
            if (square && square.textContent === "") {
                makeMove(event, index);
            }
        }

        // Arrow keys move focus around the board, stopping at the edges
        if (event.key === "ArrowDown" && index < 6) squares[index + 3].focus();
        if (event.key === "ArrowUp" && index > 2) squares[index - 3].focus();
        if (event.key === "ArrowRight" && index % 3 !== 2) squares[index + 1].focus();
        if (event.key === "ArrowLeft" && index % 3 !== 0) squares[index - 1].focus();
    }

    // Function to reset the game
    function resetGame() {
        clearTimeout(aiTimer); // drop an AI move still waiting from the previous game

        board = ["", "", "", "", "", "", "", "", ""];
        winner = null;
        currentPlayer = 'X';
        gameActive = true;
        statusText.textContent = "Player X's turn";
        endGameMessage.style.display = "none";

        squares.forEach((square) => {
            square.textContent = "";
            square.classList.remove("x", "o", "winning-square"); // clear marks and highlight from the previous game
            square.setAttribute("aria-label", `Empty cell`);
            square.removeAttribute("aria-disabled");
        });
        squares[0].focus(); // auto focus the first cell after reset
    }

    // Leave the current game and go back to the main menu, clearing all mode state
    function returnToMenu() {
        if (ws) { // leaving an online game: stop listening, and closing tells the server we left
            ws.onmessage = null;
            ws.onclose = null;
            ws.close();
            ws = null;
            symbol = null;
        }

        mode = null;
        resetGame(); // also cancels a pending AI move
        playerIndicator.textContent = "";
        resetButton.style.display = ""; // online mode hides it
        rematchButton.hidden = true;
        showMenu(aiButton);
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

    // AI Functions
    function startAIGame(difficulty) {
        mode = "ai";
        aiDifficulty = difficulty;
        switchToGame();
        resetGame();
    }

    // The AI's turn: choose a move with the shared game logic, then show it
    function playAiTurn() {
        const move = TicTacToeGame.aiMove(board, aiDifficulty, "O");
        if (move === -1) return;

        board[move] = "O";
        const cell = document.getElementById(move);
        cell.textContent = "O";
        cell.classList.add("o");
        cell.setAttribute("aria-label", "AI placed O on cell " + (move + 1));

        if (checkWinner() === true) return; // the AI's move ended the game

        currentPlayer = "X";
        statusText.textContent = `Player ${currentPlayer}'s turn`;
        statusText.setAttribute("aria-live", "assertive"); // announce status change
    }

    // Online PVP mode functions
    function startOnlineGame() {
        mode = "online";
        switchToGame();

        resetButton.style.display = "none"; // reset button is not needed for this mode

        statusText.setAttribute("aria-live", "polite");
        statusText.textContent = "Searching for an opponent...";
        gameActive = false; // disable moves until opponent connects

        currentRoom = "gameRoom";
        ws = new WebSocket("ws://localhost:3000");

        let connected = false;
        ws.onopen = () => {
            connected = true;
            ws.send(JSON.stringify({ type: "join", room: currentRoom }));
        };

        // Without this a dead or unreachable server would leave the page "searching" forever
        ws.onclose = () => {
            if (mode !== "online") return; // we left on purpose via the Menu button
            gameActive = false;
            rematchButton.hidden = true;
            statusText.textContent = connected
                ? "Lost connection to the game server."
                : "Couldn't reach the game server. Is it running?";
            statusText.setAttribute("aria-live", "polite");
        };

        ws.onmessage = (event) => {
            let data = JSON.parse(event.data);

            if (data.type === "assign") { // assign a symbol to the player and notify them about it
                symbol = data.symbol;
                playerIndicator.textContent = `You are player: ${symbol}`;
            }

            if (data.type === "start") { // first game or a rematch: begin from a clean board
                resetGame();
                rematchButton.hidden = true;
                statusText.textContent = symbol === "X"
                    ? "Game started! You go first."
                    : "Game started! Your opponent goes first.";
                statusText.setAttribute("aria-live", "polite");
            }

            if (data.type === "game_over") {
                const message = data.winner === "draw" ? "It's a draw!" : `Player ${data.winner} wins!`;
                showEndGameMessage(message);
                statusText.textContent = message;
                statusText.setAttribute("aria-live", "polite");

                // Highlight the winning combination
                data.winning_combination.forEach(index => {
                    document.getElementById(index).classList.add("winning-square");
                    document.getElementById(index).setAttribute("aria-label", `Winning move: Cell ${index + 1}`);
                });

                gameActive = false;
                rematchButton.hidden = false;
                rematchButton.disabled = false;
            }

            if (data.type === "rematch_requested") {
                statusText.textContent = "Your opponent wants a rematch!";
                statusText.setAttribute("aria-live", "polite");
            }

            if (data.type === "waiting") {
                statusText.textContent = "Searching for an opponent...";
            }

            if (data.type === "update") {
                updateOnlineBoard(data.board);
                currentPlayer = data.turn;
                board = data.board;
                
                data.board.forEach((square, index) => {
                    const squareElement = document.getElementById(index);
                    squareElement.textContent = square || "";
                    squareElement.setAttribute("aria-label", `Cell ${index + 1}, ${square || 'empty'}`);
                    squareElement.classList.remove("x", "o");
                    if (square) {
                        squareElement.classList.add(square.toLowerCase());
                    }
                });

                if (data.turn) { // turn is null once the game is over
                    statusText.textContent = `Player ${currentPlayer}'s turn`;
                    statusText.setAttribute("aria-live", "polite");
                }
            }

            if (data.type === "full") {
                endGameMessage.innerText = `Room is currently full!`;
                endGameMessage.style.display = "block";
                statusText.textContent = "Room is full!";
                statusText.setAttribute("aria-live", "polite");
            }

            if (data.type === "opponent_left") { // fresh board while we wait for someone new
                resetGame();
                rematchButton.hidden = true;
                gameActive = false;
                statusText.textContent = "Your opponent left. Waiting for a new opponent...";
                statusText.setAttribute("aria-live", "polite");
            }
        };
    }

    function onlineMove(index) {
        if (mode !== "online" || !symbol || currentPlayer !== symbol || gameActive !== true) {
            return;
        }
        if (board[index] !== "") { 
            return;
        }

        // Make the move
        board[index] = symbol;
        document.getElementById(index).textContent = symbol;
        document.getElementById(index).classList.add(symbol.toLowerCase());

        // Send move to server
        ws.send(JSON.stringify({ type: "move", room: currentRoom, index: index, symbol: symbol }));
    }

    // Ask the server for a rematch; the game restarts once both players have asked
    function requestRematch() {
        if (!ws) return;
        ws.send(JSON.stringify({ type: "rematch" }));
        rematchButton.disabled = true;
        statusText.textContent = "Waiting for your opponent to accept the rematch...";
        statusText.setAttribute("aria-live", "polite");
    }

    function updateOnlineBoard(boardState) {
        board = boardState;
        for (let i = 0; i < 9; i++) {
            document.getElementById(i).textContent = board[i] || "";
        }
    }

    // Leaderboard: show the screen, then fill it with the online results from the server
    function displayLeaderboard() {
        menuScreen.style.display = "none";
        leaderboardScreen.style.display = "flex";
        leaderboardScreen.setAttribute("tabindex", "-1"); // focusable from script only
        leaderboardScreen.focus();

        fetch('http://localhost:3000/leaderboard')
        .then(response => response.json())
        .then(rows => {
            leaderboardList.replaceChildren();
            const wins = rows.filter(row => row.winner !== "draw");
            const draws = rows.find(row => row.winner === "draw");

            if (rows.length === 0) {
                addLeaderboardRow("No online games played yet", "");
                return;
            }
            wins.forEach(row => {
                addLeaderboardRow(`Player ${row.winner}`, `${row.wins} ${row.wins === 1 ? "win" : "wins"}`);
            });
            if (draws) {
                addLeaderboardRow("Draws", String(draws.wins));
            }
        })
        .catch(error => {
            console.error('Error fetching leaderboard:', error);
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

    // Event listeners
    squares.forEach((square, index) => {
        square.addEventListener("click", (event) => makeMove(event, index));
        square.addEventListener("keydown", (event) => handleKeyPress(event, square, index));
    });

    resetButton.addEventListener('click', resetGame);
    menuButton.addEventListener('click', returnToMenu);
    rematchButton.addEventListener('click', requestRematch);
    aiBackButton.addEventListener('click', () => showMenu(aiButton));
    leaderboardBackButton.addEventListener('click', () => showMenu(leaderboardButton));
});
