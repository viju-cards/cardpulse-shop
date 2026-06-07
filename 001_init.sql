-- ════════════════════════════════════════════════════════════════════════
--  CardPulse Shop  ·  DB-Migration 001
--  Läuft gegen dieselbe Neon-DB wie CardPulse.
--  sealed_mapping wird GETEILT (beide Projekte lesen) – wir ergänzen nur.
--  shop_keys / price_cache gehören ALLEIN diesem Projekt.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Geteiltes Mapping erweitern ──────────────────────────────────────
--  cardmarket_id  = TCGGO/Cardmarket Lookup-Key (für dieses Projekt)
--  cardmarket_slug= aus der Cardmarket-URL, wird im Shopify gepflegt
--  Beide IF-NOT-EXISTS, damit die Migration gefahrlos mehrfach läuft.

ALTER TABLE sealed_mapping ADD COLUMN IF NOT EXISTS cardmarket_id   INTEGER;
ALTER TABLE sealed_mapping ADD COLUMN IF NOT EXISTS cardmarket_slug TEXT;

-- Slug ist unser primärer Widget-Lookup → eindeutig + schnell.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sealed_slug
  ON sealed_mapping (cardmarket_slug)
  WHERE cardmarket_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sealed_cm_id
  ON sealed_mapping (cardmarket_id)
  WHERE cardmarket_id IS NOT NULL;


-- ── 2. Shop-Keys (B2B-Auth, projekt-eigen) ──────────────────────────────
CREATE TABLE IF NOT EXISTS shop_keys (
  id                     SERIAL PRIMARY KEY,
  shop_name              TEXT        NOT NULL,
  contact_email          TEXT,
  api_key_hash           TEXT        NOT NULL,          -- bcrypt-Hash, nie Klartext
  api_key_prefix         TEXT        NOT NULL,          -- z.B. "sk_live_a1b2" zum Wiedererkennen
  plan                   TEXT        NOT NULL DEFAULT 'starter', -- starter|shop|pro
  monthly_requests       INTEGER     NOT NULL DEFAULT 0,
  request_limit          INTEGER     NOT NULL DEFAULT 1000,
  requests_reset_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  allowed_origins        TEXT[]      NOT NULL DEFAULT '{}', -- ['https://cardcosmos.de']
  is_active              BOOLEAN     NOT NULL DEFAULT TRUE,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopkeys_prefix ON shop_keys (api_key_prefix);
CREATE INDEX IF NOT EXISTS idx_shopkeys_active ON shop_keys (is_active);


-- ── 3. Preis-Cache (schützt das RapidAPI-Limit) ─────────────────────────
--  Ein Eintrag pro cardmarket_id. fetched_at steuert TTL.
CREATE TABLE IF NOT EXISTS price_cache (
  cardmarket_id  INTEGER     PRIMARY KEY,
  payload        JSONB       NOT NULL,        -- normalisierte Preisdaten
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricecache_fetched ON price_cache (fetched_at);


-- ── 4. Optional: Aufruf-Log für Analytics (kann später weg) ─────────────
CREATE TABLE IF NOT EXISTS shop_usage (
  id            BIGSERIAL PRIMARY KEY,
  shop_key_id   INTEGER     NOT NULL REFERENCES shop_keys(id) ON DELETE CASCADE,
  cardmarket_id INTEGER,
  cache_hit     BOOLEAN     NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_key_day
  ON shop_usage (shop_key_id, created_at);
