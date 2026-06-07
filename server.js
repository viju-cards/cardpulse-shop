// server.js – CardPulse Shop Backend
// Eigenständiger Service. Teilt sich nur die Neon-DB mit CardPulse.

const express = require("express");
require("dotenv").config();

const widgetRoutes = require("./routes/widget");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

// ── ENV-Prüfung ──────────────────────────────────────────────────────────
const REQUIRED = ["DATABASE_URL", "RAPIDAPI_KEY", "RAPIDAPI_HOST", "ADMIN_PASSWORD"];
for (const k of REQUIRED) {
  if (!process.env[k]) {
    console.error(`FATAL: ENV "${k}" fehlt.`);
    process.exit(1);
  }
}

// ── CORS (Origin wird in shopAuth pro Key gesetzt) ───────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Shop-Key, X-Admin-Password");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

// ── Health-Check (für Render + cron-job Keepalive) ───────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

// ── Statisches Widget-Script ─────────────────────────────────────────────
app.use(express.static("public"));

// ── Routen ────────────────────────────────────────────────────────────────
app.use("/widget", widgetRoutes);
app.use("/admin", adminRoutes);

app.listen(PORT, () => {
  console.log(`CardPulse Shop läuft auf Port ${PORT}`);
});
