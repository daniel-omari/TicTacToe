// The messages the browser and the server send each other over the WebSocket. Both sides
// import these types, so a misspelled message type or a missing field is a compile
// error instead of a silent bug. (Types only: nothing here exists at runtime.)

import type { Board, Mark } from "./game.js";

// Browser -> server. `player` is the browser's secret ID (see playerName in game.ts).
export type ClientMessage =
    | { type: "create"; player?: string }               // open a private room
    | { type: "join"; code: string; player?: string }   // join a private room by code
    | { type: "quick"; player?: string }                // quick match
    | { type: "move"; index: number }
    | { type: "rematch" };

// Server -> browser
export type ServerMessage =
    | { type: "room"; code: string }                    // the private room's code
    | { type: "assign"; symbol: Mark }                  // your symbol (again after a rematch)
    | { type: "waiting" }
    | { type: "start"; players: Record<Mark, string> }  // who plays which symbol
    | { type: "update"; board: Board; turn: Mark | null }
    | { type: "game_over"; winner: Mark | "draw"; winning_combination: number[] }
    | { type: "rematch_requested" }
    | { type: "opponent_left" }
    | { type: "full" }
    | { type: "not_found" };

// One row of GET /leaderboard
export interface LeaderboardRow {
    name: string;
    wins: number;
    losses: number;
    draws: number;
}
