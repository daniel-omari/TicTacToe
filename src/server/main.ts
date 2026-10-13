// Starts the game server (npm start). Kept apart from app.ts so the tests can import
// the server without it listening on a fixed port.

import { server } from "./app.js";

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
