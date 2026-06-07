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

    const norm = (product.name || "").toLowerCase().trim();
    await pool.query(
      `INSERT INTO sealed_mapping
         (cardmarket_slug, cardmarket_id, product_name, product_name_normalized)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cardmarket_slug)
       DO UPDATE SET cardmarket_id = $2, product_name = $3, product_name_normalized = $4`,
      [slug, product.cardmarket_id, product.name, norm]
    );

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
    `SELECT cardmarket_slug, cardmarket_id, product_name
       FROM sealed_mapping
      WHERE cardmarket_slug IS NOT NULL
      ORDER BY product_name`
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

module.exports = router;
