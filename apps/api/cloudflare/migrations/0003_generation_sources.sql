CREATE TABLE market_catalog_generation_sources (
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  generation INTEGER NOT NULL CHECK (generation > 0),
  source_key TEXT NOT NULL,
  dex_index INTEGER,
  resolution TEXT NOT NULL CHECK (resolution IN ('refreshed', 'fallback')),
  PRIMARY KEY (network, generation, source_key)
) WITHOUT ROWID;

INSERT INTO market_catalog_generation_sources (
  network,
  generation,
  source_key,
  dex_index,
  resolution
)
SELECT
  network,
  generation,
  source_key,
  CASE
    WHEN source_key GLOB 'perp:[0-9]*'
      THEN CAST(substr(source_key, 6) AS INTEGER)
    ELSE NULL
  END,
  'fallback'
FROM market_catalog_source_errors
WHERE source_key <> 'perp-dexs';

INSERT INTO market_catalog_generation_sources (
  network,
  generation,
  source_key,
  dex_index,
  resolution
)
SELECT
  network,
  generation,
  source_key,
  MAX(dex_index),
  'refreshed'
FROM market_catalog_records
GROUP BY network, generation, source_key
ON CONFLICT (network, generation, source_key) DO NOTHING;
