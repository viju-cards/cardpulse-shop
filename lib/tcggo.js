// lib/tcggo.js – Kapselt alle Aufrufe an die TCGGO/Cardmarket API (via RapidAPI)
//
// ENV benötigt:
//   RAPIDAPI_KEY   – dein RapidAPI-Schlüssel
//   RAPIDAPI_HOST  – cardmarket-api-tcg.p.rapidapi.com
//
// Wir nutzen NUR Cardmarket-Preise (EUR). TCGPlayer ignorieren wir hier –
// das macht CardPulse über JustTCG.
//
// Endpunkt:  GET /{game}/products/search
//   ?cardmarket_id=846733     exakter Lookup
//   ?search=Destined Rivals   Namenssuche (case-insensitive, partial)
//   ?cardmarket_ids=1,2,3     Batch (max 20)

const fetch = require("node-fetch");

const HOST = process.env.RAPIDAPI_HOST || "cardmarket-api-tcg.p.rapidapi.com";
const BASE = `https://${HOST}`;
const GAME = "pokemon";

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
async function fetchProductByCardmarketId(cardmarketId) {
  const json = await get(
    `/${GAME}/products/search?cardmarket_id=${encodeURIComponent(cardmarketId)}`
  );
  const list = Array.isArray(json.data) ? json.data : [];
  return list[0] || null;
}

// ── Mehrere auf einmal (Batch, max 20) – für den Import ──────────────────
async function fetchProductsByCardmarketIds(ids) {
  const csv = ids.slice(0, 20).join(",");
  const json = await get(
    `/${GAME}/products/search?cardmarket_ids=${encodeURIComponent(csv)}`
  );
  return Array.isArray(json.data) ? json.data : [];
}

// ── Produkt per Name suchen (fürs erstmalige Anlegen) ────────────────────
async function searchProductsByName(name, limit = 10) {
  const json = await get(
    `/${GAME}/products/search?search=${encodeURIComponent(name)}&sort=relevance`
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
    lowest:   num(cm.lowest),          // primärer Vergleichswert (alle Länder)
    lowestDE: num(cm.lowest_DE),       // optional: nur deutsche Verkäufer
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
//  Damit findest du die Episode-ID, die du für den Set-Import brauchst.
// Episodenliste ändert sich selten → kurz im Speicher cachen (1h),
// damit nicht jede Suche 9 TCGGO-Calls auslöst.
let _episodeCache = null;
let _episodeCacheAt = 0;
const EPISODE_TTL = 60 * 60 * 1000;

async function fetchEpisodes() {
  if (_episodeCache && Date.now() - _episodeCacheAt < EPISODE_TTL) {
    return _episodeCache;
  }

  const all = [];
  let page = 1;
  let totalPages = 1;

  // Alle Seiten durchlaufen (TCGGO paginiert Episoden, ~9 Seiten).
  do {
    const json = await get(`/${GAME}/episodes?page=${page}`);
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

  _episodeCache = mapped;
  _episodeCacheAt = Date.now();
  return mapped;
}

// ── Alle Sealed-Produkte einer Episode holen ─────────────────────────────
async function fetchProductsByEpisode(episodeId) {
  const json = await get(
    `/${GAME}/episodes/${encodeURIComponent(episodeId)}/products?sort=price_highest`
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
};
