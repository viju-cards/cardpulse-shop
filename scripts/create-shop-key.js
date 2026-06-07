#!/usr/bin/env node
// scripts/create-shop-key.js
//
// Erstellt einen neuen Shop-API-Key. Der Klartext-Key wird EINMALIG
// ausgegeben – danach ist nur noch der bcrypt-Hash in der DB. Notier ihn.
//
// Aufruf:
//   node scripts/create-shop-key.js \
//     --shop "Card Cosmos" \
//     --email info@cardcosmos.de \
//     --plan shop \
//     --origin https://cardcosmos.de \
//     --origin https://www.cardcosmos.de

require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { pool } = require("../lib/db");

const PLAN_LIMITS = { starter: 1000, shop: 5000, pro: 20000 };

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}
// mehrere --origin erlaubt
function args(flag) {
  const out = [];
  process.argv.forEach((a, i) => { if (a === flag) out.push(process.argv[i + 1]); });
  return out.filter(Boolean);
}

(async function main() {
  const shop = arg("--shop");
  const email = arg("--email") || null;
  const plan = (arg("--plan") || "starter").toLowerCase();
  const origins = args("--origin");

  if (!shop) { console.error("Fehler: --shop erforderlich."); process.exit(1); }
  if (!PLAN_LIMITS[plan]) {
    console.error(`Fehler: --plan muss starter|shop|pro sein.`); process.exit(1);
  }
  if (origins.length === 0) {
    console.error("Warnung: keine --origin angegeben – Key wäre von jeder Domain nutzbar.");
  }

  // Key generieren:  sk_live_<24 hex>
  const rawKey = "sk_live_" + crypto.randomBytes(18).toString("hex");
  const prefix = rawKey.slice(0, 12);
  const hash = await bcrypt.hash(rawKey, 10);

  try {
    const { rows } = await pool.query(
      `INSERT INTO shop_keys
         (shop_name, contact_email, api_key_hash, api_key_prefix,
          plan, request_limit, allowed_origins, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
       RETURNING id`,
      [shop, email, hash, prefix, plan, PLAN_LIMITS[plan], origins]
    );

    console.log("\n✓ Shop-Key erstellt");
    console.log("─".repeat(56));
    console.log(`  Shop      : ${shop}`);
    console.log(`  Plan      : ${plan}  (${PLAN_LIMITS[plan]} Aufrufe/Monat)`);
    console.log(`  Origins   : ${origins.join(", ") || "(keine!)"}`);
    console.log(`  DB-ID     : ${rows[0].id}`);
    console.log("─".repeat(56));
    console.log(`\n  API-KEY (nur jetzt sichtbar!):\n\n    ${rawKey}\n`);
    console.log("  Diesen Key dem Shop geben. In der DB liegt nur der Hash.\n");
    process.exit(0);
  } catch (err) {
    console.error("Fehler:", err.message);
    process.exit(1);
  }
})();
