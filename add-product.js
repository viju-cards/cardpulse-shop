#!/usr/bin/env node
// scripts/add-product.js
//
// Legt ein Sealed-Produkt in sealed_mapping an (oder aktualisiert es).
// Du gibst Name + gewünschten Slug, das Script findet die cardmarket_id
// über TCGGO und schreibt die Zeile. Danach läuft das Widget rein über DB.
//
// Aufruf:
//   node scripts/add-product.js --name "Paldea Evolved Booster" --slug paldea-evolved-booster
//   node scripts/add-product.js --name "..." --slug "..." --yes     (ohne Rückfrage)
//   node scripts/add-product.js --cm-id 877280 --slug paldea-evolved-booster
//
// Bei mehreren Treffern zeigt es eine Liste und fragt, welcher passt.

require("dotenv").config();
const readline = require("readline");
const { pool } = require("../lib/db");
const tcggo = require("../lib/tcggo");

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}
const hasFlag = (f) => process.argv.includes(f);

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); })
  );
}

async function upsert(slug, product) {
  const norm = (product.name || "").toLowerCase().trim();
  await pool.query(
    `INSERT INTO sealed_mapping
       (cardmarket_slug, cardmarket_id, product_name, product_name_normalized)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cardmarket_slug)
     DO UPDATE SET cardmarket_id = $2,
                   product_name = $3,
                   product_name_normalized = $4`,
    [slug, product.cardmarket_id, product.name, norm]
  );
}

(async function main() {
  const slug = (arg("--slug") || "").toLowerCase().trim();
  const name = arg("--name");
  const cmId = arg("--cm-id");
  const autoYes = hasFlag("--yes");

  if (!slug) {
    console.error("Fehler: --slug ist erforderlich.");
    process.exit(1);
  }
  if (!name && !cmId) {
    console.error("Fehler: entweder --name oder --cm-id angeben.");
    process.exit(1);
  }

  try {
    let product;

    // Direkter Weg: cardmarket_id ist schon bekannt
    if (cmId) {
      console.log(`→ Lookup per cardmarket_id ${cmId} ...`);
      product = await tcggo.fetchProductByCardmarketId(cmId);
      if (!product) {
        console.error("Kein Produkt mit dieser cardmarket_id gefunden.");
        process.exit(1);
      }
    } else {
      // Suche per Name
      console.log(`→ Suche "${name}" bei TCGGO ...`);
      const results = await tcggo.searchProductsByName(name, 10);
      if (results.length === 0) {
        console.error("Keine Treffer.");
        process.exit(1);
      }

      // Exakter Slug-Treffer? dann direkt nehmen
      const exact = results.find((p) => p.slug === slug);
      if (exact && (autoYes || results.length === 1)) {
        product = exact;
      } else {
        // Liste anzeigen
        console.log("\nGefundene Produkte:");
        results.forEach((p, i) => {
          console.log(
            `  [${i}] ${p.name}  ·  slug=${p.slug}  ·  cm_id=${p.cardmarket_id}  ·  ${p.episode ? p.episode.name : "-"}`
          );
        });
        const pick = await ask("\nWelcher Index passt? (Enter = 0, q = abbrechen) ");
        if (pick.toLowerCase() === "q") { console.log("Abgebrochen."); process.exit(0); }
        product = results[pick === "" ? 0 : parseInt(pick, 10)];
        if (!product) { console.error("Ungültige Auswahl."); process.exit(1); }
      }
    }

    if (!product.cardmarket_id) {
      console.error("Treffer hat keine cardmarket_id – kann nicht gemappt werden.");
      process.exit(1);
    }

    console.log(
      `\nMappe:\n  slug          = ${slug}\n  cardmarket_id = ${product.cardmarket_id}\n  name          = ${product.name}`
    );

    if (!autoYes) {
      const ok = await ask("Speichern? (j/N) ");
      if (ok.toLowerCase() !== "j") { console.log("Nicht gespeichert."); process.exit(0); }
    }

    await upsert(slug, product);
    console.log("✓ In sealed_mapping gespeichert.");
    process.exit(0);
  } catch (err) {
    console.error("Fehler:", err.message);
    process.exit(1);
  }
})();
