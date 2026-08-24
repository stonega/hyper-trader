CREATE TABLE market_catalog_records (
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  generation INTEGER NOT NULL CHECK (generation > 0),
  source_key TEXT NOT NULL,
  dex_index INTEGER,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('market', 'quarantined')),
  canonical_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (network, generation, canonical_id)
) WITHOUT ROWID;

CREATE INDEX market_catalog_records_source
  ON market_catalog_records (network, generation, source_key);

CREATE TABLE market_catalog_source_errors (
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  generation INTEGER NOT NULL CHECK (generation > 0),
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  error_message TEXT NOT NULL,
  status INTEGER,
  retry_after_ms INTEGER,
  PRIMARY KEY (network, generation, source_key)
) WITHOUT ROWID;

INSERT INTO market_catalog_records (
  network,
  generation,
  source_key,
  dex_index,
  record_kind,
  canonical_id,
  payload
)
SELECT
  state.network,
  state.published_generation,
  CASE json_extract(record.value, '$.family')
    WHEN 'perp' THEN
      'perp:' || coalesce(json_extract(record.value, '$.dexIndex'), 0)
    ELSE json_extract(record.value, '$.family')
  END,
  json_extract(record.value, '$.dexIndex'),
  records.record_kind,
  json_extract(record.value, '$.canonicalId'),
  record.value
FROM market_catalog_sync_state AS state
JOIN (
  SELECT 'market' AS record_kind, '$.markets' AS json_path
  UNION ALL
  SELECT 'quarantined', '$.quarantined'
) AS records
JOIN json_each(state.published_payload, records.json_path) AS record
WHERE state.published_generation IS NOT NULL;

INSERT INTO market_catalog_records (
  network,
  generation,
  source_key,
  dex_index,
  record_kind,
  canonical_id,
  payload
)
SELECT
  state.network,
  state.building_generation,
  CASE json_extract(record.value, '$.family')
    WHEN 'perp' THEN
      'perp:' || coalesce(json_extract(record.value, '$.dexIndex'), 0)
    ELSE json_extract(record.value, '$.family')
  END,
  json_extract(record.value, '$.dexIndex'),
  records.record_kind,
  json_extract(record.value, '$.canonicalId'),
  record.value
FROM market_catalog_sync_state AS state
JOIN (
  SELECT 'market' AS record_kind, '$.markets' AS json_path
  UNION ALL
  SELECT 'quarantined', '$.quarantined'
) AS records
JOIN json_each(state.building_payload, records.json_path) AS record
WHERE state.building_generation IS NOT NULL;

INSERT INTO market_catalog_source_errors (
  network,
  generation,
  source_key,
  source_name,
  error_message,
  status,
  retry_after_ms
)
SELECT
  state.network,
  state.published_generation,
  error.key,
  json_extract(error.value, '$.source'),
  json_extract(error.value, '$.message'),
  json_extract(error.value, '$.status'),
  json_extract(error.value, '$.retryAfterMs')
FROM market_catalog_sync_state AS state
JOIN json_each(state.published_payload, '$.sourceErrors') AS error
WHERE state.published_generation IS NOT NULL;

INSERT INTO market_catalog_source_errors (
  network,
  generation,
  source_key,
  source_name,
  error_message,
  status,
  retry_after_ms
)
SELECT
  state.network,
  state.building_generation,
  error.key,
  json_extract(error.value, '$.source'),
  json_extract(error.value, '$.message'),
  json_extract(error.value, '$.status'),
  json_extract(error.value, '$.retryAfterMs')
FROM market_catalog_sync_state AS state
JOIN json_each(state.building_payload, '$.sourceErrors') AS error
WHERE state.building_generation IS NOT NULL;

CREATE TABLE market_catalog_sync_state_next (
  network TEXT PRIMARY KEY CHECK (network IN ('testnet', 'mainnet')),
  published_generation INTEGER,
  published_at_ms INTEGER,
  building_generation INTEGER,
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
    (published_generation IS NULL AND published_at_ms IS NULL)
    OR
    (published_generation IS NOT NULL AND published_at_ms IS NOT NULL)
  )
);

INSERT INTO market_catalog_sync_state_next (
  network,
  published_generation,
  published_at_ms,
  building_generation,
  core_ready,
  next_builder_offset,
  builder_total,
  page_failures,
  lease_owner,
  lease_generation,
  lease_expires_at_ms,
  next_attempt_at_ms,
  updated_at_ms
)
SELECT
  network,
  published_generation,
  published_at_ms,
  building_generation,
  core_ready,
  next_builder_offset,
  builder_total,
  page_failures,
  lease_owner,
  lease_generation,
  lease_expires_at_ms,
  next_attempt_at_ms,
  updated_at_ms
FROM market_catalog_sync_state;

DROP TABLE market_catalog_sync_state;
ALTER TABLE market_catalog_sync_state_next RENAME TO market_catalog_sync_state;
