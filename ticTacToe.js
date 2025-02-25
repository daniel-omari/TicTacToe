"use strict";
document.addEventListener("DOMContentLoaded", () => {

    let board = ["", "", "", "", "", "", "", "", ""]; // represents the 3x3 board
    let currentPlayer = 'X'; // player 'X' starts first
    let gameActive = true;
    let isAI = false;
    let winner = null; // keeps track of winner
    let aiDifficulty = "easy"; // default AI difficulty

    // Elements
    const menuScreen = document.getElementById("menu-screen");
    const gameContainer = document.getElementById("game-container");
    const offlineButton = document.getElementById("offline");
    const onlineButton = document.getElementById("online");
    const squares = document.querySelectorAll('.square');
    const statusText = document.getElementById('status');
    const resetButton = document.getElementById('reset');
    const endGameMessage = document.getElementById("endGameMessage");

    // AI buttons
    const aiButton = document.getElementById("ai");
    const easyButton = document.getElementById("aiEasy");
    const mediumButton = document.getElementById("aiMedium");
    const impossibleButton = document.getElementById("aiHard");
    const aiModeSelection = document.getElementById("ai-mode-selection");

    easyButton.addEventListener("click", () => startAIGame("easy"));
    mediumButton.addEventListener("click", () => startAIGame("medium"));
    impossibleButton.addEventListener("click", () => startAIGame("impossible"));

    function applyTheme(theme){
        document.body.classList.remove("offline-theme", "ai-theme", "online-theme");
        document.body.classList.add(`${theme}-theme`)
    }

    // Colour themes for each mode
    document.getElementById("offline").addEventListener("click", () => applyTheme("offline"));
    document.getElementById("ai").addEventListener("click", () => applyTheme("ai"));
    document.getElementById("online").addEventListener("click", () => applyTheme("online"));

    function switchToGame() {
        menuScreen.style.display = "none";
        aiModeSelection.style.display = "none";
        gameContainer.style.display = "flex";
    }

    // Offline PvP mode (hide UI move to PVP gamescreen)
    offlineButton.addEventListener("click", () => { switchToGame(); resetGame();});
    // AI mode selection
    aiButton.addEventListener("click", () => { menuScreen.style.display = "none"; aiModeSelection.style.display = "flex";});

    function startAIGame(difficulty) {
        isAI = true;
        aiDifficulty = difficulty;
        switchToGame();
        resetGame();
    }

    // Function to check if there is a winner or if the game is a draw
    function checkWinner() {
        // All possible winning combinations
        const winningPatterns = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

        for (const pattern of winningPatterns) {
            const [a, b, c] = pattern;

            // Check for winning combinations and detect winner
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                gameActive = false;
                winner = board[a];
            
                // Highlight winning combination
                document.getElementById(a).classList.add("winning-square");
                document.getElementById(b).classList.add("winning-square");
                document.getElementById(c).classList.add("winning-square");

                // Display winning message
                endGameMessage.textContent = `Player ${winner} WINS!`;
                statusText.textContent = `Player ${board[a]} wins!`;
                endGameMessage.style.display = "block";
                return true;
            }
        }
        
        // Check if the game is a draw
        if (!board.includes("")) {
            gameActive = false;
            statusText.textContent = "It's a draw!";
            showEndGameMessage("It's a draw!");
            return true;
        }
        
        return false;
    }
    // Same as regular checkWinner() function but without UI as it is only for the AI move simulations
    function checkWinnerSimulated(simulatedBoard) {
        const winningPatterns = [[0, 1, 2], [3, 4, 5], [6, 7, 8],[0, 3, 6], [1, 4, 7], [2, 5, 8],[0, 4, 8], [2, 4, 6]];
        
        for (const pattern of winningPatterns) {
            const [a, b, c] = pattern;
            if (simulatedBoard[a] && simulatedBoard[a] === simulatedBoard[b] && simulatedBoard[a] === simulatedBoard[c]) {
                return simulatedBoard[a];
            }
        }
    
        return null;
    }

    // Function to show the winner or draw message
    function showEndGameMessage(message) {
        endGameMessage.textContent = message;
        endGameMessage.style.display = 'block';
    }

    // Handle a player's move
    function makeMove(event) {
        const index = event.target.id;
        if (board[index] !== "" || !gameActive) return; // prevents moves after game has ended

        // Player's move
        board[index] = currentPlayer;
        event.target.textContent = currentPlayer;
        event.target.classList.add(currentPlayer.toLowerCase());

        if (checkWinner()) return; // check for win or draw after player's move

        currentPlayer = currentPlayer === 'X' ? 'O' : 'X'; // switch to the other player
        statusText.textContent = `Player ${currentPlayer}'s turn`;

        if (isAI && currentPlayer === "O") { // AI moves only if AI mode is active and it's AI's turn
            setTimeout(() => aiMove(board, aiDifficulty), 500); // call AI function from separate file
        }
    }

    // Function to reset the game
    function resetGame() {

        board = ["", "", "", "", "", "", "", "", ""];
        winner = null;
        currentPlayer = 'X';
        gameActive = true;
        statusText.textContent = "Player X's turn";
        endGameMessage.style.display = "none";

        document.querySelector(".board").classList.remove("winner-x", "winner-o");

        squares.forEach(square => {
            square.textContent = "";
            square.classList.remove("x", "o", "winning-square"); // remove x and o's from previoust game and highlight
            square.addEventListener('click', makeMove);
        });
    }

    // AI Functions
    function aiMove(board, difficulty) {
        let move;
    
        if (difficulty === "easy") {
            move = easyAIMove(board);
        }
    
        else if (difficulty === "medium") {
            move = mediumAIMove(board);
        }
        
        else {
            move = impossibleAIMove(board);
        }
    
        if (move !== -1) {
            board[move] = "O"; // update board
            document.getElementById(move).textContent = "O"; // update UI
            document.getElementById(move).classList.add("o");
    
            if (checkWinner()) return; // check if AI's move resulted in a win or draw
    
            // Turn switches back to player X once AI's move has been made
            currentPlayer = "X";
            statusText.textContent = `Player ${currentPlayer}'s turn`;
        }
    }
    
    function easyAIMove(board) { // pretty much moves randomly
        const available = board.map((val, i) => (val === "" ? i : null)).filter(val => val !== null);
        return available.length ? available[Math.floor(Math.random() * available.length)] : -1;
    }
    
    function mediumAIMove(board) { // %70 accuracy
        if (Math.random() < 0.7) return impossibleAIMove(board);
        return easyAIMove(board);
    }
    
    function impossibleAIMove(board) { // almost unbeatable
        let bestMove = -1;
        let bestScore = -Infinity;
    
        for (let i = 0; i < board.length; i++) {
            if (board[i] === "") {
                board[i] = "O";
                let score = minimax(board, 0, false);
                board[i] = "";
    
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = i;
                }
            }
        }
        return bestMove;
    }
    
    function minimax(board, depth, isMaximizing, alpha, beta) { // Alpha-Beta pruning used to speed up AI decission making
        let winner = checkWinnerSimulated(board);
        if (winner === "O") return 10 - depth;
        if (winner === "X") return depth - 10;
        if (!board.includes("")) return 0;
    
        let bestScore = isMaximizing ? -Infinity : Infinity;
    
        for (let i = 0; i < board.length; i++) {
            if (board[i] === "") {
                let simulatedBoard = [...board];
                simulatedBoard[i] = isMaximizing ? "O" : "X";
    
                let score = minimax(simulatedBoard, depth + 1, !isMaximizing);
                bestScore = isMaximizing ? Math.max(score, bestScore) : Math.min(score, bestScore);

                // Alpha-Beta pruning (for faster AI responses)
                if (isMaximizing) {
                    alpha = Math.max(alpha, bestScore);
                    if (beta <= alpha) break;
                } else {
                    beta = Math.min(beta, bestScore);
                    if (beta <= alpha) break;
                }
            }
        }
        return bestScore;
    }

    // Event listeners
    squares.forEach(square => square.addEventListener('click', makeMove));
    resetButton.addEventListener('click', resetGame);
});
