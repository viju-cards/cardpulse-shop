// routes/admin.js – Browser-steuerbare Admin-Funktionen.
// Ersetzt die Terminal-Scripts: Produkt anlegen + Shop-Key erstellen.
//
// Schutz: Header  X-Admin-Password  muss ADMIN_PASSWORD (ENV) entsprechen.
//
//   POST /admin/add-product       { name?, slug, cmId? }
//   POST /admin/create-shop-key   { shop, email?, plan?, origins: [] }
//   GET  /admin/products          (Liste der gemappten Produkte)
//   GET  /admin/shop-keys         (Liste der Keys, ohne Klartext)

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const router = express.Router();

const { pool } = require("../lib/db");
const tcggo = require("../lib/tcggo");
const justtcg = require("../lib/justtcg");

const PLAN_LIMITS = { starter: 1000, shop: 5000, pro: 20000 };

// Aus dem Cardmarket-Slug die beiden Namensfelder ableiten:
//   slug "phantasmal-flames-booster"
//   → normalized "phantasmal flames booster"   (klein, Leerzeichen)
//   → display    "Phantasmal Flames Booster"   (Wortanfänge groß)
function slugToNormalized(slug) {
  return (slug || "").replace(/-/g, " ").toLowerCase().trim();
}
function slugToDisplay(slug) {
  return slugToNormalized(slug)
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Zentrale Upsert-Funktion – schreibt in die echten Spalten:
//   cardmarket_slug, cardmarket_id, tcg_player_id (optional),
//   cardmarket_name_normalized (NOT NULL), tcgplayer_name (NOT NULL)
async function upsertMapping({ slug, cardmarketId, tcgplayerId }) {
  const normalized = slugToNormalized(slug);
  const display = slugToDisplay(slug);
  await pool.query(
    `INSERT INTO sealed_mapping
       (cardmarket_slug, cardmarket_id, tcg_player_id,
        cardmarket_name_normalized, tcgplayer_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cardmarket_slug)
     DO UPDATE SET cardmarket_id = $2,
                   tcg_player_id = COALESCE($3, sealed_mapping.tcg_player_id),
                   cardmarket_name_normalized = $4,
                   tcgplayer_name = $5`,
    [slug, cardmarketId, tcgplayerId || null, normalized, display]
  );
}

// ── Passwortschutz für alle /admin-Routen ────────────────────────────────
router.use((req, res, next) => {
  const pw = req.headers["x-admin-password"];
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: "ADMIN_PASSWORD_NOT_SET" });
  }
  if (pw !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  next();
});

// ── Produkt anlegen / aktualisieren ──────────────────────────────────────
//  Entweder cmId direkt, oder name → TCGGO-Suche.
router.post("/add-product", async (req, res) => {
  const slug = (req.body.slug || "").toLowerCase().trim();
  const name = req.body.name;
  const cmId = req.body.cmId;

  if (!slug) return res.status(400).json({ error: "MISSING_SLUG" });
  if (!name && !cmId) return res.status(400).json({ error: "NEED_NAME_OR_CMID" });

  try {
    let product;

    if (cmId) {
      product = await tcggo.fetchProductByCardmarketId(cmId);
      if (!product) return res.status(404).json({ error: "NOT_FOUND_BY_CMID" });
    } else {
      const results = await tcggo.searchProductsByName(name, 10);
      if (results.length === 0) return res.status(404).json({ error: "NO_MATCHES" });

      // exakter Slug-Treffer bevorzugt, sonst ersten nehmen
      product = results.find((p) => p.slug === slug) || results[0];

      // Wenn mehrdeutig, gib die Liste zurück damit du gezielt per cmId nachfasst
      if (!req.body.force && results.length > 1 && product.slug !== slug) {
        return res.status(300).json({
          error: "MULTIPLE_MATCHES",
          hint: "Wähle per cmId aus der Liste, oder sende force:true",
          matches: results.map((p) => ({
            name: p.name, slug: p.slug, cmId: p.cardmarket_id,
            episode: p.episode ? p.episode.name : null,
          })),
        });
      }
    }

    if (!product.cardmarket_id) {
      return res.status(422).json({ error: "NO_CARDMARKET_ID" });
    }

    await upsertMapping({
      slug,
      cardmarketId: product.cardmarket_id,
    });

    res.json({
      saved: true,
      slug,
      cardmarketId: product.cardmarket_id,
      name: product.name,
    });
  } catch (err) {
    console.error("[/admin/add-product]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// ── Shop-Key erstellen ───────────────────────────────────────────────────
router.post("/create-shop-key", async (req, res) => {
  const shop = req.body.shop;
  const email = req.body.email || null;
  const plan = (req.body.plan || "starter").toLowerCase();
  const origins = Array.isArray(req.body.origins) ? req.body.origins : [];

  if (!shop) return res.status(400).json({ error: "MISSING_SHOP" });
  if (!PLAN_LIMITS[plan]) return res.status(400).json({ error: "INVALID_PLAN" });

  try {
    const rawKey = "sk_live_" + crypto.randomBytes(18).toString("hex");
    const prefix = rawKey.slice(0, 12);
    const hash = await bcrypt.hash(rawKey, 10);

    const { rows } = await pool.query(
      `INSERT INTO shop_keys
         (shop_name, contact_email, api_key_hash, api_key_prefix,
          plan, request_limit, allowed_origins, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
       RETURNING id`,
      [shop, email, hash, prefix, plan, PLAN_LIMITS[plan], origins]
    );

    // Klartext-Key NUR hier einmalig zurückgeben
    res.json({
      created: true,
      id: rows[0].id,
      shop,
      plan,
      limit: PLAN_LIMITS[plan],
      origins,
      apiKey: rawKey,
      warning: "Diesen Key sofort notieren – er wird nie wieder angezeigt.",
    });
  } catch (err) {
    console.error("[/admin/create-shop-key]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// ── Übersichten ──────────────────────────────────────────────────────────
router.get("/products", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT cardmarket_slug, cardmarket_id, tcgplayer_name, cardmarket_name_normalized
       FROM sealed_mapping
      WHERE cardmarket_slug IS NOT NULL
      ORDER BY tcgplayer_name`
  );
  res.json({ count: rows.length, products: rows });
});

router.get("/shop-keys", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, shop_name, contact_email, plan, request_limit,
            monthly_requests, allowed_origins, is_active, created_at
       FROM shop_keys
      ORDER BY created_at DESC`
  );
  res.json({ count: rows.length, keys: rows });
});

// ── Batch-Import ─────────────────────────────────────────────────────────
//  Body: { items: [ { slug, name? , cmId? }, ... ] }
//  Pro Zeile entweder cmId (direkt) oder name (TCGGO-Suche).
//  Gibt pro Zeile ein Ergebnis zurück (saved / error), bricht nie komplett ab.
router.post("/batch-import", async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: "NO_ITEMS" });
  if (items.length > 100) return res.status(400).json({ error: "TOO_MANY", max: 100 });

  const results = [];

  for (const item of items) {
    const slug = (item.slug || "").trim();
    if (!slug) { results.push({ slug: null, ok: false, error: "MISSING_SLUG" }); continue; }

    try {
      let cardmarketId = item.cmId || null;
      let tcgplayerId = item.tcgId || null;
      let name = item.name || null;

      // Nur dann TCGGO fragen, wenn wir die ID NICHT schon haben.
      // Set-Import liefert cmId + tcgId mit → gar kein API-Call → kein Rate-Limit.
      if (!cardmarketId) {
        if (!name) {
          results.push({ slug, ok: false, error: "NEED_NAME_OR_CMID" });
          continue;
        }
        const matches = await tcggo.searchProductsByName(name, 10);
        const product = matches.find((p) => p.slug === slug) || matches[0];
        if (!product || !product.cardmarket_id) {
          results.push({ slug, ok: false, error: "NOT_FOUND" });
          continue;
        }
        cardmarketId = product.cardmarket_id;
        tcgplayerId = product.tcgplayer_id ?? tcgplayerId;
        name = product.name;
      }

      if (!name) name = slug;

      await upsertMapping({ slug, cardmarketId, tcgplayerId });
      results.push({ slug, ok: true, cardmarketId, tcgplayerId, name });
    } catch (err) {
      results.push({ slug, ok: false, error: err.message });
    }
  }

  const saved = results.filter((r) => r.ok).length;
  res.json({ total: items.length, saved, failed: items.length - saved, results });
});

// ── Episoden (Sets) auflisten – um die Episode-ID zu finden ──────────────
router.get("/episodes", async (req, res) => {
  try {
    let episodes = await tcggo.fetchEpisodes();
    const q = (req.query.q || "").toLowerCase().trim();
    if (q) {
      episodes = episodes.filter(
        (e) =>
          (e.name || "").toLowerCase().includes(q) ||
          (e.code || "").toLowerCase().includes(q) ||
          (e.slug || "").toLowerCase().includes(q)
      );
    }
    res.json({ count: episodes.length, episodes });
  } catch (err) {
    console.error("[/admin/episodes]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// ── Set-Vorschau: alle Produkte einer Episode (noch NICHT speichern) ─────
//  Liefert pro Produkt den TCGGO-Slug + cardmarket_id + Preis,
//  damit du in der UI je Zeile den Slug bestätigen/anpassen kannst.
router.get("/episode-products", async (req, res) => {
  const episodeId = req.query.episodeId;
  if (!episodeId) return res.status(400).json({ error: "MISSING_EPISODE_ID" });

  try {
    const raw = await tcggo.fetchProductsByEpisode(episodeId);
    const products = raw.map((p) => {
      const norm = tcggo.normalizePrices(p);
      return {
        tcggoSlug: p.slug,
        cardmarketId: p.cardmarket_id,
        tcgplayerId: p.tcgplayer_id ?? null,
        name: p.name,
        lowest: norm.lowest,
        avg30d: norm.avg30d,
      };
    });
    res.json({ count: products.length, products });
  } catch (err) {
    console.error("[/admin/episode-products]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// ── tcgplayer_id nachziehen über JustTCG ─────────────────────────────────

// Einträge OHNE tcgplayer_id auflisten (Kandidaten zum Nachziehen)
router.get("/missing-tcgid", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT cardmarket_slug, cardmarket_id, tcgplayer_name
       FROM sealed_mapping
      WHERE cardmarket_slug IS NOT NULL
        AND tcg_player_id IS NULL
        AND tcg_no_match = FALSE
      ORDER BY tcgplayer_name`
  );
  res.json({ count: rows.length, products: rows });
});

// Einen Eintrag als "kein TCGPlayer-Pendant" markieren (verschwindet aus der Liste)
router.post("/mark-no-match", async (req, res) => {
  const slug = (req.body.slug || "").trim();
  if (!slug) return res.status(400).json({ error: "MISSING_SLUG" });
  try {
    const r = await pool.query(
      "UPDATE sealed_mapping SET tcg_no_match = TRUE WHERE lower(cardmarket_slug) = lower($1)",
      [slug]
    );
    res.json({ updated: r.rowCount, slug });
  } catch (err) {
    console.error("[/admin/mark-no-match]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// Markierung zurücknehmen (Eintrag erscheint wieder in der Liste)
router.post("/unmark-no-match", async (req, res) => {
  const slug = (req.body.slug || "").trim();
  if (!slug) return res.status(400).json({ error: "MISSING_SLUG" });
  try {
    const r = await pool.query(
      "UPDATE sealed_mapping SET tcg_no_match = FALSE WHERE lower(cardmarket_slug) = lower($1)",
      [slug]
    );
    res.json({ updated: r.rowCount, slug });
  } catch (err) {
    console.error("[/admin/unmark-no-match]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// Alle als "kein Match" markierten Einträge auflisten (zum Zurücksetzen)
router.get("/no-match-list", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT cardmarket_slug, cardmarket_id, tcgplayer_name
       FROM sealed_mapping
      WHERE tcg_no_match = TRUE
      ORDER BY tcgplayer_name`
  );
  res.json({ count: rows.length, products: rows });
});
// Für EINEN Eintrag bei JustTCG nach Sealed-Kandidaten suchen.
// Sucht über tcgplayer_name; einzeln ausgelöst (schont das 100/Tag-Limit).
router.get("/search-tcgid", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "MISSING_QUERY" });
  try {
    const { candidates, quota } = await justtcg.searchSealed(q);

    // Bereits in der DB vergebene tcgplayer_ids holen → aus Treffern entfernen,
    // damit dieselbe ID nicht versehentlich zweimal zugewiesen wird.
    const usedRows = await pool.query(
      "SELECT tcg_player_id FROM sealed_mapping WHERE tcg_player_id IS NOT NULL"
    );
    const used = new Set(usedRows.rows.map((r) => String(r.tcg_player_id)));

    const free = candidates.filter((c) => !used.has(String(c.tcgplayerId)));
    const removedUsed = candidates.length - free.length;

    const filtered = justtcg.filterStrict(q, free);
    res.json({
      query: q,
      candidates: filtered,        // streng gefiltert + nur freie IDs
      allCandidates: free,         // volle Sealed-Liste, aber ohne schon vergebene
      hidden: free.length - filtered.length,
      removedUsed,                 // wie viele wegen "schon vergeben" entfernt wurden
      quota,
    });
  } catch (err) {
    console.error("[/admin/search-tcgid]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// Gewählte tcgplayer_id für einen Slug speichern
router.post("/set-tcgid", async (req, res) => {
  const slug = (req.body.slug || "").trim();
  const tcgId = req.body.tcgId;
  if (!slug || !tcgId) return res.status(400).json({ error: "MISSING_SLUG_OR_TCGID" });
  try {
    const result = await pool.query(
      `UPDATE sealed_mapping
          SET tcg_player_id = $2
        WHERE lower(cardmarket_slug) = lower($1)`,
      [slug, tcgId]
    );
    res.json({ updated: result.rowCount, slug, tcgId });
  } catch (err) {
    console.error("[/admin/set-tcgid]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// Welche Preisbasis wurde verwendet (für die Anzeige)?
function priceBasis(p) {
  if (p.lowest != null) return "lowest";
  if (p.avg30d != null) return "30d-avg";
  if (p.avg7d != null) return "7d-avg";
  return null;
}

// Cardmarket-Preis eines Eintrags holen (für den Plausibilitäts-Abgleich).
// Nutzt denselben price_cache wie das Widget → meist kein TCGGO-Call.
router.get("/cardmarket-price", async (req, res) => {
  const cardmarketId = req.query.cmId;
  if (!cardmarketId) return res.status(400).json({ error: "MISSING_CM_ID" });
  try {
    // Cache prüfen (12h TTL, gleich wie Widget)
    const cached = await pool.query(
      "SELECT payload, fetched_at FROM price_cache WHERE cardmarket_id = $1",
      [cardmarketId]
    );
    const TTL = 12 * 60 * 60 * 1000;
    if (cached.rows.length > 0 &&
        Date.now() - new Date(cached.rows[0].fetched_at).getTime() < TTL) {
      const p = cached.rows[0].payload;
      const val = p.lowest ?? p.avg30d ?? p.avg7d ?? null;
      // Nur den Cache nutzen, wenn er WIRKLICH einen Preis hat.
      // Sonst (alter null-Eintrag aus früherer Wrapper-Version) frisch holen.
      if (val != null) {
        return res.json({ lowest: val, basis: priceBasis(p), currency: p.currency || "EUR", cached: true });
      }
    }
    // sonst frisch holen + cachen
    const product = await tcggo.fetchProductByCardmarketId(cardmarketId);
    if (!product) return res.status(404).json({ error: "NOT_FOUND" });
    const payload = tcggo.normalizePrices(product);
    await pool.query(
      `INSERT INTO price_cache (cardmarket_id, payload, fetched_at)
            VALUES ($1, $2, NOW())
       ON CONFLICT (cardmarket_id)
       DO UPDATE SET payload = $2, fetched_at = NOW()`,
      [cardmarketId, payload]
    );
    const val = payload.lowest ?? payload.avg30d ?? payload.avg7d ?? null;
    res.json({ lowest: val, basis: priceBasis(payload), currency: payload.currency || "EUR", cached: false });
  } catch (err) {
    console.error("[/admin/cardmarket-price]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

module.exports = router;
