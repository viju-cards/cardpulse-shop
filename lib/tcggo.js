// lib/tcggo.js – Kapselt alle Aufrufe an die TCGGO/Cardmarket API (via RapidAPI)
//
// ENV benötigt:
//   RAPIDAPI_KEY   – dein RapidAPI-Schlüssel
//   RAPIDAPI_HOST  – cardmarket-api-tcg.p.rapidapi.com
//
// Wir nutzen NUR Cardmarket-Preise (EUR). TCGPlayer ignorieren wir hier –
// das macht CardPulse über JustTCG.
//
// Unterstützte Spiele (game-Slug): "pokemon", "lorcana", "one-piece".
// Jede Funktion nimmt game als letzten Parameter; Default = "pokemon",
// damit bestehende Aufrufe unverändert weiterlaufen.

const fetch = require("node-fetch");

const HOST = process.env.RAPIDAPI_HOST || "cardmarket-api-tcg.p.rapidapi.com";
const BASE = `https://${HOST}`;

// Erlaubte Spiele – schützt davor, dass ein Tippfehler einen kaputten
// API-Pfad erzeugt. Unbekannter Wert → fällt auf "pokemon" zurück.
const SUPPORTED_GAMES = new Set(["pokemon", "lorcana", "one-piece"]);
function safeGame(game) {
  return SUPPORTED_GAMES.has(game) ? game : "pokemon";
}

function headers() {
  return {
    "x-rapidapi-key": process.env.RAPIDAPI_KEY,
    "x-rapidapi-host": HOST,
    "Accept": "application/json",
  };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TCGGO ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Produkt per cardmarket_id (Standardweg fürs Widget) ──────────────────
async function fetchProductByCardmarketId(cardmarketId, game = "pokemon") {
  const g = safeGame(game);
  const json = await get(
    `/${g}/products/search?cardmarket_id=${encodeURIComponent(cardmarketId)}`
  );
  const list = Array.isArray(json.data) ? json.data : [];
  return list[0] || null;
}

// ── Mehrere auf einmal (Batch, max 20) – für den Import ──────────────────
async function fetchProductsByCardmarketIds(ids, game = "pokemon") {
  const g = safeGame(game);
  const csv = ids.slice(0, 20).join(",");
  const json = await get(
    `/${g}/products/search?cardmarket_ids=${encodeURIComponent(csv)}`
  );
  return Array.isArray(json.data) ? json.data : [];
}

// ── Produkt per Name suchen (fürs erstmalige Anlegen) ────────────────────
async function searchProductsByName(name, limit = 10, game = "pokemon") {
  const g = safeGame(game);
  const json = await get(
    `/${g}/products/search?search=${encodeURIComponent(name)}&sort=relevance`
  );
  const list = Array.isArray(json.data) ? json.data : [];
  return list.slice(0, limit);
}

// ── Rohes Produktobjekt → unser schlankes, stabiles Format ───────────────
function normalizePrices(product) {
  const cm = (product && product.prices && product.prices.cardmarket) || {};

  return {
    name: product.name || null,
    slug: product.slug || null,
    cardmarketId: product.cardmarket_id ?? null,
    tcgplayerId: product.tcgplayer_id ?? null,
    currency: cm.currency || "EUR",
    lowest:   num(cm.lowest),
    lowestDE: num(cm.lowest_DE),
    avg7d:    num(cm["7d_average"]),
    avg30d:   num(cm["30d_average"]),
    image: product.image || null,
    episode: product.episode ? product.episode.name : null,
  };
}

function num(v) {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

// ── Alle Episoden (Sets) eines Spiels auflisten ──────────────────────────
// Cache jetzt PRO SPIEL (Map), damit Pokémon/Lorcana/One-Piece sich nicht
// gegenseitig überschreiben.
const _episodeCache = new Map();   // game → { data, at }
const EPISODE_TTL = 60 * 60 * 1000;

async function fetchEpisodes(game = "pokemon") {
  const g = safeGame(game);
  const cached = _episodeCache.get(g);
  if (cached && Date.now() - cached.at < EPISODE_TTL) {
    return cached.data;
  }

  const all = [];
  let page = 1;
  let totalPages = 1;

  do {
    const json = await get(`/${g}/episodes?page=${page}`);
    const list = Array.isArray(json.data) ? json.data : [];
    all.push(...list);
    totalPages = (json.paging && json.paging.total) ? json.paging.total : 1;
    page++;
  } while (page <= totalPages);

  const mapped = all.map((e) => ({
    id: e.id,
    name: e.name,
    slug: e.slug,
    code: e.code || null,
    releasedAt: e.released_at || null,
  }));

  _episodeCache.set(g, { data: mapped, at: Date.now() });
  return mapped;
}

// ── Alle Sealed-Produkte einer Episode holen ─────────────────────────────
async function fetchProductsByEpisode(episodeId, game = "pokemon") {
  const g = safeGame(game);
  const json = await get(
    `/${g}/episodes/${encodeURIComponent(episodeId)}/products?sort=price_highest`
  );
  return Array.isArray(json.data) ? json.data : [];
}

module.exports = {
  fetchProductByCardmarketId,
  fetchProductsByCardmarketIds,
  searchProductsByName,
  fetchEpisodes,
  fetchProductsByEpisode,
  normalizePrices,
  SUPPORTED_GAMES,
};
