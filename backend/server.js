const path = require("path");
const express = require("express");
const cors = require("cors");

const { buildRoutes, ensureAdminUser } = require("./routes");

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve frontend static files
const frontendDir = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendDir));

// API
app.use("/api", buildRoutes());

// SPA-ish convenience for direct page opens (multi-page site)
app.get("/", (req, res) => res.sendFile(path.join(frontendDir, "index.html")));

ensureAdminUser()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to initialize server:", err);
    process.exit(1);
  });

