"use strict";
let board = Array(9).fill(null); // represents the 3x3 board
let currentPlayer = 'X'; // player 'X' starts first
let winner = null; // keeps track of winner

const squares = document.querySelectorAll('.square');
const statusText = document.getElementById('status');
const resetButton = document.getElementById('reset');
const endGameMessage = document.getElementById("endGameMessage");

// All possible winning combinations
const winningPatterns = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const newGrid = () => printBoard(3, 3, () => null)

// Function to check if there is a winner or if the game is a draw
function checkWinner() {

    for (let pattern of winningPatterns) {
        const [a, b, c] = pattern;

        // Check for winning combinations and detect winner
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            winner = board[a];
            statusText.textContent = `Player ${winner} wins!`;
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
        square.classList.remove("x", "o");
    });
}

// Event listeners
squares.forEach(square => square.addEventListener('click', makeMove));
resetButton.addEventListener('click', resetGame);

// Main game loop
function startGame() {
    const grid = newGrid()
    console.log(grid)
}

// Start the game
startGame();