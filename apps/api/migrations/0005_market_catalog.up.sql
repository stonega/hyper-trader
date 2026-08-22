CREATE TABLE market_catalog_generations (
  network text NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  generation bigint NOT NULL CHECK (generation > 0),
  state text NOT NULL CHECK (state IN ('building', 'published', 'retired')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  PRIMARY KEY (network, generation),
  CHECK ((state = 'published') = (published_at IS NOT NULL))
);

CREATE UNIQUE INDEX market_catalog_one_building_generation_idx
  ON market_catalog_generations (network)
  WHERE state = 'building';

CREATE UNIQUE INDEX market_catalog_one_published_generation_idx
  ON market_catalog_generations (network)
  WHERE state = 'published';

CREATE TABLE market_catalog_records (
  network text NOT NULL,
  generation bigint NOT NULL,
  source_key text NOT NULL
    CHECK (source_key ~ '^(perp:[0-9]+|spot|outcome)$'),
  dex_index integer CHECK (dex_index IS NULL OR dex_index >= 0),
  record_kind text NOT NULL CHECK (record_kind IN ('market', 'quarantined')),
  canonical_id text NOT NULL CHECK (char_length(canonical_id) BETWEEN 1 AND 256),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (network, generation, source_key, record_kind, canonical_id),
  UNIQUE (network, generation, record_kind, canonical_id),
  FOREIGN KEY (network, generation)
    REFERENCES market_catalog_generations (network, generation)
    ON DELETE CASCADE
);

CREATE INDEX market_catalog_records_generation_idx
  ON market_catalog_records (network, generation, record_kind, canonical_id);

CREATE TABLE market_catalog_source_errors (
  network text NOT NULL,
  generation bigint NOT NULL,
  source_key text NOT NULL
    CHECK (source_key ~ '^(perp:[0-9]+|spot|outcome|perp-dexs)$'),
  source_name text NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 256),
  error_message text NOT NULL CHECK (char_length(error_message) BETWEEN 1 AND 1024),
  status integer CHECK (status IS NULL OR status BETWEEN 400 AND 599),
  retry_after_ms integer CHECK (retry_after_ms IS NULL OR retry_after_ms BETWEEN 0 AND 86400000),
  PRIMARY KEY (network, generation, source_key),
  FOREIGN KEY (network, generation)
    REFERENCES market_catalog_generations (network, generation)
    ON DELETE CASCADE
);

CREATE TABLE market_catalog_sync_state (
  network text PRIMARY KEY CHECK (network IN ('testnet', 'mainnet')),
  published_generation bigint,
  building_generation bigint,
  core_ready boolean NOT NULL DEFAULT false,
  next_builder_offset integer NOT NULL DEFAULT 0 CHECK (next_builder_offset >= 0),
  builder_total integer CHECK (builder_total IS NULL OR builder_total >= 0),
  page_failures integer NOT NULL DEFAULT 0 CHECK (page_failures BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text CHECK (lease_owner IS NULL OR char_length(lease_owner) BETWEEN 1 AND 128),
  lease_generation integer NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK (building_generation IS NOT NULL OR
         (core_ready = false AND next_builder_offset = 0 AND builder_total IS NULL)),
  FOREIGN KEY (network, published_generation)
    REFERENCES market_catalog_generations (network, generation),
  FOREIGN KEY (network, building_generation)
    REFERENCES market_catalog_generations (network, generation)
);

CREATE INDEX market_catalog_sync_due_idx
  ON market_catalog_sync_state (next_attempt_at)
  WHERE lease_owner IS NULL;
