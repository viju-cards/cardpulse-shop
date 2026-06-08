// routes/widget.js – Die zentrale Route, die das Shop-Widget aufruft.
//
//   GET /widget/sealed?slug=paldea-evolved-booster
//   Header: X-Shop-Key: sk_live_xxxxx
//
// Ablauf:
//   1. Shop-Auth (Key, Origin, Limit)            → lib/shopAuth
//   2. Slug → cardmarket_id                       → sealed_mapping
//   3. Cache-Check (< TTL alt?)                   → price_cache
//        ja  → DB-Preis (KEIN RapidAPI-Call)
//        nein→ TCGGO holen, normalisieren, cachen
//   4. Antwort + Zähler hoch

const express = require("express");
const router = express.Router();

const { pool } = require("../lib/db");
const { authenticateShop, incrementUsage } = require("../lib/shopAuth");
const tcggo = require("../lib/tcggo");

// Cache-Lebensdauer. 12h = Preise sind frisch genug, RapidAPI bleibt geschont.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

router.get("/sealed", authenticateShop, async (req, res) => {
  const slug = (req.query.slug || "").trim();
  if (!slug) {
    return res.status(400).json({ error: "MISSING_SLUG" });
  }

  try {
    // ── 2. Slug → cardmarket_id (case-insensitiv, robust gegen Schreibweise) ─
    const map = await pool.query(
      `SELECT cardmarket_id, tcgplayer_name
         FROM sealed_mapping
        WHERE lower(cardmarket_slug) = lower($1)
        LIMIT 1`,
      [slug]
    );

    if (map.rows.length === 0 || !map.rows[0].cardmarket_id) {
      // Produkt ist (noch) nicht gemappt → Widget zeigt neutralen Zustand
      return res.status(404).json({ error: "PRODUCT_NOT_MAPPED", slug });
    }

    const cardmarketId = map.rows[0].cardmarket_id;
    const productName = map.rows[0].tcgplayer_name;

    // ── 3. Cache-Check ─────────────────────────────────────────────────
    let payload = null;
    let cacheHit = false;

    const cached = await pool.query(
      "SELECT payload, fetched_at FROM price_cache WHERE cardmarket_id = $1",
      [cardmarketId]
    );

    if (cached.rows.length > 0) {
      const age = Date.now() - new Date(cached.rows[0].fetched_at).getTime();
      if (age < CACHE_TTL_MS) {
        const cp = cached.rows[0].payload;
        // Nur nutzen, wenn ein echter Preis drin ist (kein alter null-Eintrag)
        if (cp && (cp.lowest != null || cp.avg30d != null || cp.avg7d != null)) {
          payload = cp;
          cacheHit = true;
        }
      }
    }

    // ── Cache miss → TCGGO holen ───────────────────────────────────────
    if (!payload) {
      const product = await tcggo.fetchProductByCardmarketId(cardmarketId);
      if (!product) {
        return res.status(404).json({ error: "PRODUCT_NOT_FOUND_UPSTREAM" });
      }
      payload = tcggo.normalizePrices(product);

      // in Cache schreiben (upsert)
      await pool.query(
        `INSERT INTO price_cache (cardmarket_id, payload, fetched_at)
              VALUES ($1, $2, NOW())
         ON CONFLICT (cardmarket_id)
         DO UPDATE SET payload = $2, fetched_at = NOW()`,
        [cardmarketId, payload]
      );
    }

    // ── 4. Zähler + optionales Usage-Log ───────────────────────────────
    await incrementUsage(req.shop.id);
    pool
      .query(
        `INSERT INTO shop_usage (shop_key_id, cardmarket_id, cache_hit)
              VALUES ($1, $2, $3)`,
        [req.shop.id, cardmarketId, cacheHit]
      )
      .catch(() => {}); // Log-Fehler nie den Request killen lassen

    // ── Antwort ────────────────────────────────────────────────────────
    res.json({
      product: {
        name: payload.name || productName,
        slug,
        episode: payload.episode || null,
        image: payload.image || null,
      },
      price: {
        currency: payload.currency || "EUR",
        lowest: payload.lowest,      // primärer Vergleichswert (alle Länder)
        lowestDE: payload.lowestDE,  // optional: nur deutsche Verkäufer
        avg7d: payload.avg7d,
        avg30d: payload.avg30d,
      },
      theme: req.shop.theme || null,   // pro-Shop-Design (oder null = Default)
      meta: {
        source: "cardmarket",
        cacheHit,
        used: req.shopUsed + 1,
        limit: req.shop.request_limit,
        plan: req.shop.plan,
      },
    });
  } catch (err) {
    console.error("[/widget/sealed]", err.message);
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

module.exports = router;
