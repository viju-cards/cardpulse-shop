// lib/fx.js – USD→EUR Wechselkurs, einmal täglich von frankfurter.app geholt
// und in der Tabelle fx_rate gecacht. Kostenlos, kein API-Key nötig.

const fetch = require("node-fetch");
const { pool } = require("./db");

const PAIR = "USD_EUR";
const FALLBACK = 0.92;            // Notwert, falls API & Cache leer sind
const MAX_AGE = 20 * 60 * 60 * 1000; // 20 h: einmal pro Tag reicht

let _mem = null;     // { rate, at }

async function getUsdToEur() {
  // 1. Speicher-Cache (schnellster Pfad)
  if (_mem && Date.now() - _mem.at < MAX_AGE) return _mem.rate;

  // 2. DB-Cache
  try {
    const { rows } = await pool.query(
      "SELECT rate, fetched_at FROM fx_rate WHERE pair = $1",
      [PAIR]
    );
    if (rows.length) {
      const ageMs = Date.now() - new Date(rows[0].fetched_at).getTime();
      if (ageMs < MAX_AGE) {
        _mem = { rate: Number(rows[0].rate), at: Date.now() };
        return _mem.rate;
      }
    }
  } catch (e) {
    // Tabelle evtl. noch nicht da – ignorieren, weiter zur API
  }

  // 3. Frisch holen
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR");
    if (res.ok) {
      const json = await res.json();
      const rate = json && json.rates && json.rates.EUR;
      if (rate && rate > 0) {
        _mem = { rate, at: Date.now() };
        // in DB schreiben (best effort)
        pool
          .query(
            `INSERT INTO fx_rate (pair, rate, fetched_at)
                  VALUES ($1, $2, NOW())
             ON CONFLICT (pair) DO UPDATE SET rate = $2, fetched_at = NOW()`,
            [PAIR, rate]
          )
          .catch(() => {});
        return rate;
      }
    }
  } catch (e) {
    // Netzfehler – unten Fallback
  }

  // 4. Letzter DB-Wert (auch wenn alt) oder Fallback
  try {
    const { rows } = await pool.query("SELECT rate FROM fx_rate WHERE pair = $1", [PAIR]);
    if (rows.length) return Number(rows[0].rate);
  } catch (e) {}
  return FALLBACK;
}

module.exports = { getUsdToEur };
