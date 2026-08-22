CREATE TABLE market_catalog_sync_state (
  network TEXT PRIMARY KEY CHECK (network IN ('testnet', 'mainnet')),
  published_generation INTEGER,
  published_at_ms INTEGER,
  published_payload TEXT,
  building_generation INTEGER,
  building_payload TEXT,
  core_ready INTEGER NOT NULL DEFAULT 0 CHECK (core_ready IN (0, 1)),
  next_builder_offset INTEGER NOT NULL DEFAULT 0,
  builder_total INTEGER,
  page_failures INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0,
  lease_expires_at_ms INTEGER,
  next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL DEFAULT 0,
  CHECK (
    (published_generation IS NULL AND published_at_ms IS NULL AND published_payload IS NULL)
    OR
    (published_generation IS NOT NULL AND published_at_ms IS NOT NULL AND published_payload IS NOT NULL)
  ),
  CHECK (
    (building_generation IS NULL AND building_payload IS NULL)
    OR
    (building_generation IS NOT NULL AND building_payload IS NOT NULL)
  )
);
