// lib/justtcg.js – Kapselt JustTCG-Aufrufe (nur für tcgplayer_id-Suche).
//
// ENV benötigt:
//   JUSTTCG_KEY   – dein JustTCG API-Key (x-api-key Header)
//
// Wichtig: JustTCG Free Tier = 100 Anfragen/Tag. Deshalb wird die Suche
// im Frontend nur EINZELN, manuell ausgelöst – nie automatisch in Schleife.

const fetch = require("node-fetch");

const BASE = "https://api.justtcg.com/v1";

function headers() {
  return {
    "x-api-key": process.env.JUSTTCG_KEY,
    "Accept": "application/json",
  };
}

// Sucht nach Namen, gibt NUR versiegelte Produkte als Kandidaten zurück.
// Ein Treffer gilt als sealed, wenn eine Variante condition === "Sealed" hat.
async function searchSealed(name) {
  const url = `${BASE}/cards?q=${encodeURIComponent(name)}&game=pokemon&limit=20`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`JustTCG ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const data = Array.isArray(json.data) ? json.data : [];

  const candidates = data
    .map((card) => {
      const sealedVariant = (card.variants || []).find(
        (v) => (v.condition || "").toLowerCase() === "sealed"
      );
      if (!sealedVariant) return null; // keine Sealed-Variante → raus
      return {
        tcgplayerId: card.tcgplayerId || null,
        name: card.name,
        setName: card.set_name || null,
        price: sealedVariant.price ?? null,
      };
    })
    .filter((c) => c && c.tcgplayerId); // nur mit ID

  // Tageslimit-Info aus der Antwort durchreichen (zur Anzeige)
  const meta = json._metadata || {};
  return {
    candidates,
    quota: {
      dailyRemaining: meta.apiDailyRequestsRemaining ?? null,
      dailyLimit: meta.apiDailyLimit ?? null,
    },
  };
}

module.exports = { searchSealed };
