// lib/db.js – PostgreSQL-Pool (Neon, geteilt mit CardPulse)
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("[DB] Unerwarteter Pool-Fehler:", err.message);
});

module.exports = { pool };
