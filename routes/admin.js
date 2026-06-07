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

const PLAN_LIMITS = { starter: 1000, shop: 5000, pro: 20000 };

// Zentrale Upsert-Funktion – schreibt in die ECHTEN Spalten der Tabelle:
//   cardmarket_name_normalized (NOT NULL), tcgplayer_name (NOT NULL),
//   cardmarket_slug, cardmarket_id, product_type
function makeNormalized(name) {
  return (name || "").toLowerCase().trim();
}
async function upsertMapping({ slug, cardmarketId, name, productType }) {
  const normalized = makeNormalized(name);
  await pool.query(
    `INSERT INTO sealed_mapping
       (cardmarket_slug, cardmarket_id, cardmarket_name_normalized, tcgplayer_name, product_type)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cardmarket_slug)
     DO UPDATE SET cardmarket_id = $2,
                   cardmarket_name_normalized = $3,
                   tcgplayer_name = $4,
                   product_type = COALESCE($5, sealed_mapping.product_type)`,
    [slug, cardmarketId, normalized, name || normalized, productType || "sealed"]
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
      name: product.name,
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
      let name = item.name || null;

      // Nur dann TCGGO fragen, wenn wir die ID NICHT schon haben.
      // Set-Import liefert cmId + name mit → gar kein API-Call → kein Rate-Limit.
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
        name = product.name;
      }

      if (!name) name = slug;

      await upsertMapping({ slug, cardmarketId, name });
      results.push({ slug, ok: true, cardmarketId, name });
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

module.exports = router;
