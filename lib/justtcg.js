// lib/justtcg.js – Kapselt JustTCG-Aufrufe (nur für tcgplayer_id-Suche).
//
// ENV benötigt:
//   JUSTTCG_KEY   – dein JustTCG API-Key (x-api-key Header)
//
// Wichtig: JustTCG Free Tier = 100 Anfragen/Tag. Deshalb wird die Suche
// im Frontend nur EINZELN, manuell ausgelöst – nie automatisch in Schleife.

const fetch = require("node-fetch");

const BASE = "https://api.justtcg.com/v1";

function headers() {
  return {
    "x-api-key": process.env.JUSTTCG_KEY,
    "Accept": "application/json",
  };
}

// Sucht nach Namen, gibt NUR versiegelte Produkte als Kandidaten zurück.
// Ein Treffer gilt als sealed, wenn eine Variante condition === "Sealed" hat.
// Roher JustTCG-Call für einen Suchbegriff → Liste von Sealed-Kandidaten + quota.
async function rawSearch(q) {
  const url = `${BASE}/cards?q=${encodeURIComponent(q)}&game=pokemon&limit=20`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      const e = new Error("JUSTTCG_RATE_LIMIT");
      e.rateLimit = true;
      throw e;
    }
    throw new Error(`JustTCG ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const data = Array.isArray(json.data) ? json.data : [];

  const candidates = data
    .map((card) => {
      const sealedVariant = (card.variants || []).find(
        (v) => (v.condition || "").toLowerCase() === "sealed"
      );
      if (!sealedVariant) return null;
      return {
        tcgplayerId: card.tcgplayerId || null,
        name: card.name,
        setName: card.set_name || null,
        price: sealedVariant.price ?? null,
      };
    })
    .filter((c) => c && c.tcgplayerId);

  const meta = json._metadata || {};
  return {
    candidates,
    quota: {
      dailyRemaining: meta.apiDailyRequestsRemaining ?? null,
      dailyLimit: meta.apiDailyLimit ?? null,
    },
  };
}

async function searchSealed(name) {
  // 1. Suche mit dem vollen Produktnamen.
  const first = await rawSearch(name);
  let candidates = first.candidates;
  let quota = first.quota;

  // 2. Wenn nach dem strengen Filter kein/kaum Treffer übrig bliebe, breiter
  //    nachsuchen – nur mit den Set-Wörtern (z.B. "chilling reign"). Das fängt
  //    Fälle, in denen ein eingestreutes Pokémon-Wort ("Eevee") oder die
  //    Wortreihenfolge die JustTCG-Suche verwässert.
  const strictHits = filterStrict(name, candidates);
  if (strictHits.length === 0) {
    const setWords = extractSetWords(name).join(" ");
    // Nur nachsuchen, wenn es überhaupt Set-Wörter gibt und sie sich vom
    // Originalnamen unterscheiden (sonst doppelter identischer Call).
    if (setWords && setWords.toLowerCase() !== name.trim().toLowerCase()) {
      try {
        const second = await rawSearch(setWords);
        quota = second.quota; // aktuelleres Limit
        // Kandidaten zusammenführen, Duplikate per tcgplayerId vermeiden.
        const seen = new Set(candidates.map((c) => String(c.tcgplayerId)));
        second.candidates.forEach((c) => {
          if (!seen.has(String(c.tcgplayerId))) {
            seen.add(String(c.tcgplayerId));
            candidates.push(c);
          }
        });
      } catch (e) {
        if (e.rateLimit) throw e; // Limit auch hier sauber durchreichen
        // andere Fehler bei der Zweitsuche ignorieren – Erstergebnis bleibt
      }
    }
  }

  return { candidates, quota };
}

// ── Produkttyp-Klassifizierung (spezifisch → allgemein, Reihenfolge zählt) ──
const TYPE_RULES = [
  ["booster-box-case",        /booster box case|\d+\s*booster box case/],
  ["elite-trainer-box-case",  /elite trainer box case|etb case/],
  ["sleeved-booster-case",    /sleeved booster(?: box)? case/],
  ["booster-bundle-case",     /booster bundle case/],
  ["build-battle-box-display",/build\s*&?\s*battle box display|build and battle box display/],
  ["build-battle-stadium",    /build\s*&?\s*battle stadium|build and battle stadium/],
  ["build-battle-box",        /build\s*&?\s*battle box|build and battle box/],
  ["ultra-premium-collection",/ultra[-\s]?premium collection/],
  ["premium-collection",      /premium collection/],
  ["elite-trainer-box",       /elite trainer box|\betb\b/],
  // Art Bundle / Fun Pack VOR booster-bundle und booster-pack, sonst werden sie falsch einsortiert
  ["art-bundle",              /art bundle/],
  ["fun-pack",                /fun pack/],
  ["booster-bundle",          /booster bundle/],
  ["sleeved-booster",         /sleeved booster/],
  ["checklane-blister",       /checklane|check\s?lane/],
  ["blister",                 /blister/],
  ["mini-tin",                /mini tin/],
  ["binder-collection",       /binder/],
  ["poster-collection",       /poster collection/],
  ["build-battle",            /build\s*&?\s*battle/],
  ["tin",                     /\btin\b/],
  // "Half Booster Box", "Booster Box 18 Boosters" und "Booster Box" alle → booster-box
  ["booster-box",             /booster box/],
  // Einzelner Pack: NUR "booster pack" oder das alleinstehende Wort "booster".
  // KEIN generisches \bpack\b mehr (fing "Fun Pack", "Art Bundle [Set]" etc.).
  ["booster-pack",            /booster pack|\bbooster\b/],
];

function classifyType(name) {
  const n = (name || "").toLowerCase();
  for (const [type, rx] of TYPE_RULES) {
    if (rx.test(n)) return type;
  }
  return "other";
}

// Generische / typ-bezogene Wörter, die NICHT zum Set-Namen gehören
const GENERIC = new Set([
  "the","pokemon","pokémon","tcg","trading","card","cards","game","english",
  "sealed","set","of","and","pack","box","case","display","bundle","collection",
  "blister","booster","elite","trainer","sleeved","mini","tin","build","battle",
  "stadium","premium","ultra","checklane","checkline","single","binder","poster",
  "art","scarlet","violet","sv","me","sword","shield","3","6","10","18","24",
  "1","2","4","5","pcs","pack","packs"
]);

// Set-relevante Wörter aus einem Produktnamen ziehen (Typ-Wörter entfernt)
function extractSetWords(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));
}

// Strenger Filter: gleiches Set UND gleicher Typ.
// queryName = der Name aus sealed_mapping, gegen den wir matchen.
function filterStrict(queryName, candidates) {
  const qType = classifyType(queryName);
  const qSetWords = extractSetWords(queryName);

  return candidates.filter((c) => {
    // Typ-Match (wenn der Query-Typ erkennbar ist)
    if (qType !== "other") {
      if (classifyType(c.name) !== qType) return false;
    }
    // Set-Match: alle Set-Wörter der Query müssen im Kandidatentext vorkommen
    const hay = ((c.name || "") + " " + (c.setName || "")).toLowerCase();
    if (qSetWords.length > 0) {
      const allPresent = qSetWords.every((w) => hay.includes(w));
      if (!allPresent) return false;
    }
    return true;
  });
}

// Holt den aktuellen Sealed-Preis (USD) für eine bekannte tcgplayer_id.
// Sucht per Produktname und pickt aus den Treffern den mit passender ID.
async function fetchPriceByTcgId(name, tcgId) {
  const { candidates } = await searchSealed(name);
  const hit = candidates.find((c) => String(c.tcgplayerId) === String(tcgId));
  return hit && hit.price != null ? Number(hit.price) : null;
}

module.exports = { searchSealed, filterStrict, classifyType, extractSetWords, fetchPriceByTcgId };
