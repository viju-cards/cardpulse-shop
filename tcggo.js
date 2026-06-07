// lib/tcggo.js – Kapselt alle Aufrufe an die TCGGO/Cardmarket API (via RapidAPI)
//
// ENV benötigt:
//   RAPIDAPI_KEY   – dein RapidAPI-Schlüssel
//   RAPIDAPI_HOST  – z.B. "pokemon-tcg-api.p.rapidapi.com"
//
// Wir nutzen NUR Cardmarket-Preise. TCGPlayer ignorieren wir hier bewusst –
// das macht CardPulse über JustTCG.

const fetch = require("node-fetch");

const HOST = process.env.RAPIDAPI_HOST || "pokemon-tcg-api.p.rapidapi.com";
const BASE = `https://${HOST}`;

function headers() {
  return {
    "x-rapidapi-key": process.env.RAPIDAPI_KEY,
    "x-rapidapi-host": HOST,
    "Accept": "application/json",
  };
}

// ── Produkt per cardmarket_id holen (der schnelle Standardweg) ───────────
async function fetchProductByCardmarketId(cardmarketId) {
  const url = `${BASE}/pokemon/products?cardmarket_id=${encodeURIComponent(cardmarketId)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TCGGO ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  // API liefert eine Liste – wir nehmen den ersten Treffer.
  const product = Array.isArray(json.data) ? json.data[0] : json.data;
  return product || null;
}

// ── Produkt per Name/Slug suchen (für das erstmalige Anlegen) ────────────
//  Gibt eine Liste zurück, damit das Admin-Script den richtigen Treffer
//  auswählen kann (Slug-Vergleich).
async function searchProductsByName(name, limit = 10) {
  const url = `${BASE}/pokemon/products?name=${encodeURIComponent(name)}&limit=${limit}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TCGGO ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

// ── Rohes Produktobjekt → unser schlankes, stabiles Format ───────────────
//  Das ist das einzige Format, das je in price_cache landet und ans Widget
//  geht. Falls TCGGO seine Felder ändert, müssen wir nur HIER anpassen.
function normalizePrices(product) {
  const cm = (product && product.prices && product.prices.cardmarket) || {};

  // TCGGO nutzt bei Sealed teils "lowest", bei Singles "lowest_near_mint".
  // Wir greifen beide Varianten ab und nehmen den ersten gefüllten Wert.
  const lowest =
    firstNum(cm.lowest, cm.lowest_near_mint, cm.lowest_EU_only);

  return {
    name: product.name || null,
    slug: product.slug || null,
    cardmarketId: product.cardmarket_id ?? null,
    currency: cm.currency || "EUR",
    lowest: lowest,                                  // primärer Vergleichswert
    avg7d: firstNum(cm["7d_average"], cm.avg_7d),
    avg30d: firstNum(cm["30d_average"], cm.avg_30d),
    image: product.image || null,
    episode: product.episode ? product.episode.name : null,
  };
}

function firstNum(...vals) {
  for (const v of vals) {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return null;
}

module.exports = {
  fetchProductByCardmarketId,
  searchProductsByName,
  normalizePrices,
};
