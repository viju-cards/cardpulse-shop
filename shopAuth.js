// lib/shopAuth.js – Authentifizierung & Rate-Limiting für Shop-Widgets
//
// Anders als CardPulse (User-JWT) authentifizieren Shops über einen
// langlebigen API-Key im Header  X-Shop-Key: sk_live_xxxxx
// Zusätzlich binden wir den Key per CORS-Whitelist an die Shop-Domain.

const bcrypt = require("bcrypt");
const { pool } = require("./db");

// Key-Format:  sk_live_<prefix12>...<rest>
//  Der Prefix wird im Klartext gespeichert (idx) → schneller Lookup,
//  der ganze Key bcrypt-gehasht → Diebstahl der DB gibt keinen Key her.
function prefixOf(rawKey) {
  return rawKey.slice(0, 12); // "sk_live_a1b2"
}

async function authenticateShop(req, res, next) {
  const rawKey = req.headers["x-shop-key"];
  if (!rawKey || !rawKey.startsWith("sk_")) {
    return res.status(401).json({ error: "MISSING_SHOP_KEY" });
  }

  try {
    // 1) Kandidaten über den Prefix holen (kann mehrere geben → alle prüfen)
    const { rows } = await pool.query(
      "SELECT * FROM shop_keys WHERE api_key_prefix = $1 AND is_active = TRUE",
      [prefixOf(rawKey)]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: "INVALID_SHOP_KEY" });
    }

    // 2) Hash-Vergleich gegen die Kandidaten
    let shop = null;
    for (const row of rows) {
      if (await bcrypt.compare(rawKey, row.api_key_hash)) {
        shop = row;
        break;
      }
    }
    if (!shop) {
      return res.status(401).json({ error: "INVALID_SHOP_KEY" });
    }

    // 3) Origin-Whitelist prüfen (Key nur von erlaubter Domain nutzbar)
    const origin = req.headers["origin"] || req.headers["referer"] || "";
    if (shop.allowed_origins.length > 0) {
      const ok = shop.allowed_origins.some((allowed) =>
        origin.startsWith(allowed)
      );
      if (!ok) {
        return res
          .status(403)
          .json({ error: "ORIGIN_NOT_ALLOWED", origin: origin || null });
      }
      // CORS-Antwort exakt auf die erlaubte Domain setzen
      res.header("Access-Control-Allow-Origin", matchOrigin(shop, origin));
    }

    // 4) Monatslimit prüfen + ggf. zurücksetzen
    const now = new Date();
    const resetAt = shop.requests_reset_at
      ? new Date(shop.requests_reset_at)
      : new Date(0);
    let used = shop.monthly_requests || 0;

    const newMonth =
      now.getUTCFullYear() !== resetAt.getUTCFullYear() ||
      now.getUTCMonth() !== resetAt.getUTCMonth();

    if (newMonth) {
      used = 0;
      await pool.query(
        "UPDATE shop_keys SET monthly_requests = 0, requests_reset_at = NOW() WHERE id = $1",
        [shop.id]
      );
    }

    if (used >= shop.request_limit) {
      return res.status(429).json({
        error: "LIMIT_REACHED",
        plan: shop.plan,
        used,
        limit: shop.request_limit,
      });
    }

    // alles ok → Shop an den Request hängen
    req.shop = shop;
    req.shopUsed = used;
    next();
  } catch (err) {
    console.error("[shopAuth]", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
}

function matchOrigin(shop, origin) {
  const hit = shop.allowed_origins.find((a) => origin.startsWith(a));
  return hit || shop.allowed_origins[0] || "*";
}

// Zähler nach erfolgreicher Antwort hochsetzen (im Route-Handler aufrufen)
async function incrementUsage(shopId) {
  await pool.query(
    "UPDATE shop_keys SET monthly_requests = monthly_requests + 1 WHERE id = $1",
    [shopId]
  );
}

module.exports = { authenticateShop, incrementUsage };
