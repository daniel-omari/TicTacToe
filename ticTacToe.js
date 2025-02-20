"use strict";
document.addEventListener("DOMContentLoaded", () => {

    function applyTheme(theme){
        document.body.classList.remove("offline-theme", "ai-theme", "online-theme");
        document.body.classList.add(`${theme}-theme`)
    }

    let board = Array(9).fill(null); // represents the 3x3 board
    let currentPlayer = 'X'; // player 'X' starts first
    let winner = null; // keeps track of winner

    // Elements
    const menuScreen = document.getElementById("menu-screen");
    const gameContainer = document.getElementById("game-container");
    const offlineButton = document.getElementById("offline");
    const squares = document.querySelectorAll('.square');
    const statusText = document.getElementById('status');
    const resetButton = document.getElementById('reset');
    const endGameMessage = document.getElementById("endGameMessage");

    // Colour themes for each mode
    document.getElementById("offline").addEventListener("click", () => applyTheme("offline"));
    document.getElementById("ai").addEventListener("click", () => applyTheme("ai"));
    document.getElementById("online").addEventListener("click", () => applyTheme("online"));

    // All possible winning combinations
    const winningPatterns = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

    // Move to game screen (hiding the menu) when "Player VS Player (Offline)" option has been selected
    offlineButton.addEventListener("click", () => {
        menuScreen.style.display = "none";
        gameContainer.style.display = "block";
    });

    // Function to check if there is a winner or if the game is a draw
    function checkWinner() {
        for (let pattern of winningPatterns) {
            const [a, b, c] = pattern;

            // Check for winning combinations and detect winner
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                winner = board[a];
            
                // Highlight winning combination
                document.getElementById(a).classList.add("winning-square");
                document.getElementById(b).classList.add("winning-square");
                document.getElementById(c).classList.add("winning-square");

                // Display winning message
                endGameMessage.textContent = `Player ${winner} WINS!`;
                endGameMessage.style.display = "block";
                document.querySelector(".board").classList.add(`winner-${winner.toLowerCase()}`);

                disableBoard();
                return;
            }
        }
    
        // Check if the game is a draw
        if (board.every(square => square !== null)) {
            showEndGameMessage("It's a draw!");
            }
        }

    // Function to show the winner or draw message
    function showEndGameMessage(message) {
        const endGameMessageElement = document.getElementById("endGameMessage");
        endGameMessageElement.textContent = message;
        endGameMessageElement.style.display = 'block';
    }

    // Function to handle a player's move
    function makeMove(e) {
        const index = e.target.id;

        if (!board[index] && !winner) {
            board[index] = currentPlayer;
            e.target.textContent = currentPlayer;
            e.target.classList.add(currentPlayer.toLowerCase());

            checkWinner();
            currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
            statusText.textContent = `Player ${currentPlayer}'s turn`;
        }
    }

    // Disable board once the game has ended
    function disableBoard() {
        squares.forEach(square => square.removeEventListener('click', makeMove));
    }

    // Function to reset the game
    function resetGame() {

        board = Array(9).fill(null);
        winner = null;
        currentPlayer = 'X';
        statusText.textContent = "Player X's turn";
        endGameMessage.style.display = "none";

        document.querySelector(".board").classList.remove("winner-x", "winner-o");

        squares.forEach(square => {
            square.textContent = "";
            square.addEventListener('click', makeMove);
            square.classList.remove("x", "o"); // remove x and o's from previoust game
            square.classList.remove("winning-square"); // remove the highlight
        });
    }

    // Event listeners
    squares.forEach(square => square.addEventListener('click', makeMove));
    resetButton.addEventListener('click', resetGame);
});