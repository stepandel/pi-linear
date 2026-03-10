import { serve } from "@hono/node-server";
import { app } from "./server.js";

const port = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`pi-linear agent listening on http://localhost:${info.port}`);
  console.log("Endpoints:");
  console.log("  GET  /health          — Health check");
  console.log("  POST /webhooks/linear — Linear webhook receiver");
});
