import { app } from "./server.js";

const port = parseInt(process.env.PORT || "3000", 10);

const server = Bun.serve({
  fetch: app.fetch,
  port,
});

console.log(`pi-linear agent listening on http://localhost:${server.port}`);
console.log("Endpoints:");
console.log("  GET  /health          — Health check");
console.log("  POST /webhooks/linear — Linear webhook receiver");
