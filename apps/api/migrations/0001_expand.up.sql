CREATE TABLE IF NOT EXISTS notification_service_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_phase text NOT NULL CHECK (schema_phase IN ('expand', 'migrated', 'contracted')),
  restore_state text NOT NULL CHECK (restore_state IN ('blocked', 'replaying', 'ready')),
  ledger_watermark bigint NOT NULL DEFAULT 0 CHECK (ledger_watermark >= 0),
  ledger_head bigint NOT NULL DEFAULT 0 CHECK (ledger_head >= ledger_watermark),
  mutations_enabled boolean NOT NULL DEFAULT false,
  monitors_enabled boolean NOT NULL DEFAULT false,
  delivery_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO notification_service_state (singleton, schema_phase, restore_state)
VALUES (true, 'expand', 'blocked')
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS notification_admission_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('mutation', 'token_change', 'failed_proof')),
  installation_id char(32) CHECK (installation_id IS NULL OR installation_id ~ '^[0-9a-f]{32}$'),
  ip_address inet NOT NULL,
  status text NOT NULL DEFAULT 'committed' CHECK (status IN ('pending', 'committed', 'failed')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind = 'failed_proof' AND status IN ('pending', 'failed')) OR
         (kind <> 'failed_proof' AND status = 'committed'))
);

CREATE INDEX IF NOT EXISTS notification_admission_ip_window_idx
  ON notification_admission_events (ip_address, occurred_at DESC);
CREATE INDEX IF NOT EXISTS notification_admission_installation_window_idx
  ON notification_admission_events (installation_id, occurred_at DESC)
  WHERE installation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_installations (
  installation_id char(32) PRIMARY KEY CHECK (installation_id ~ '^[0-9a-f]{32}$'),
  credential_hash bytea UNIQUE CHECK (credential_hash IS NULL OR octet_length(credential_hash) = 32),
  recovery_scope_mac bytea UNIQUE CHECK (recovery_scope_mac IS NULL OR octet_length(recovery_scope_mac) = 32),
  recovery_key_version text CHECK (recovery_key_version IS NULL OR char_length(recovery_key_version) BETWEEN 1 AND 128),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'draining', 'inactive')),
  credential_generation integer NOT NULL DEFAULT 1 CHECK (credential_generation > 0),
  revocation_generation integer NOT NULL DEFAULT 0 CHECK (revocation_generation >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz
  ,CHECK ((state = 'inactive' AND credential_hash IS NULL) OR
          (state IN ('active', 'draining') AND credential_hash IS NOT NULL)),
  CHECK ((state = 'inactive' AND revoked_at IS NOT NULL) OR
         (state IN ('active', 'draining') AND revoked_at IS NULL))
);

CREATE TABLE IF NOT EXISTS notification_push_tokens (
  token_id char(32) PRIMARY KEY CHECK (token_id ~ '^[0-9a-f]{32}$'),
  installation_id char(32) NOT NULL REFERENCES notification_installations(installation_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'expo'),
  token_fingerprint bytea NOT NULL UNIQUE CHECK (octet_length(token_fingerprint) = 32),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 17 AND 2048),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  key_version text NOT NULL CHECK (char_length(key_version) BETWEEN 1 AND 128),
  wrapped_dek bytea CHECK (wrapped_dek IS NULL OR octet_length(wrapped_dek) BETWEEN 16 AND 4096),
  recovery_scope_mac bytea UNIQUE CHECK (recovery_scope_mac IS NULL OR octet_length(recovery_scope_mac) = 32),
  recovery_key_version text CHECK (recovery_key_version IS NULL OR char_length(recovery_key_version) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (installation_id, provider)
);

CREATE TABLE IF NOT EXISTS notification_account_link_challenges (
  challenge_id char(32) PRIMARY KEY CHECK (challenge_id ~ '^[0-9a-f]{32}$'),
  challenge_hash bytea NOT NULL UNIQUE CHECK (octet_length(challenge_hash) = 32),
  credential_hash bytea NOT NULL CHECK (octet_length(credential_hash) = 32),
  installation_id char(32) NOT NULL REFERENCES notification_installations(installation_id) ON DELETE CASCADE,
  network text NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  master_account char(42) NOT NULL CHECK (master_account ~ '^0x[0-9a-f]{40}$'),
  target_account char(42) NOT NULL CHECK (target_account ~ '^0x[0-9a-f]{40}$'),
  purpose text NOT NULL CHECK (purpose IN (
    'notification-account-link',
    'notification-account-rule-mutation',
    'notification-push-token-rebind',
    'notification-installation-revoke'
  )),
  operation_digest bytea NOT NULL CHECK (octet_length(operation_digest) = 32),
  service_origin text NOT NULL CHECK (service_origin ~ '^https://[^/]+$'),
  proof_version smallint NOT NULL DEFAULT 1 CHECK (proof_version = 1),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'consumed')),
  consumed_at timestamptz,
  CHECK (expires_at = issued_at + interval '5 minutes'),
  CHECK ((state = 'pending' AND consumed_at IS NULL) OR (state = 'consumed' AND consumed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS notification_challenges_issue_limit_idx
  ON notification_account_link_challenges (installation_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS notification_challenges_cleanup_idx
  ON notification_account_link_challenges (expires_at);

CREATE TABLE IF NOT EXISTS notification_account_links (
  account_link_id char(32) PRIMARY KEY CHECK (account_link_id ~ '^[0-9a-f]{32}$'),
  installation_id char(32) NOT NULL REFERENCES notification_installations(installation_id) ON DELETE CASCADE,
  network text NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  master_account char(42) NOT NULL CHECK (master_account ~ '^0x[0-9a-f]{40}$'),
  target_account char(42) NOT NULL CHECK (target_account ~ '^0x[0-9a-f]{40}$'),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'draining', 'inactive')),
  revocation_generation integer NOT NULL DEFAULT 0 CHECK (revocation_generation >= 0),
  proof_version smallint NOT NULL CHECK (proof_version = 1),
  relationship_result text NOT NULL CHECK (char_length(relationship_result) BETWEEN 1 AND 64),
  verified_at timestamptz NOT NULL,
  recovery_scope_mac bytea UNIQUE CHECK (recovery_scope_mac IS NULL OR octet_length(recovery_scope_mac) = 32),
  recovery_key_version text CHECK (recovery_key_version IS NULL OR char_length(recovery_key_version) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (installation_id, network, master_account, target_account),
  UNIQUE (account_link_id, installation_id, network)
);

CREATE INDEX IF NOT EXISTS notification_account_links_installation_idx
  ON notification_account_links (installation_id, state);

CREATE TABLE IF NOT EXISTS notification_rules (
  rule_id char(32) PRIMARY KEY CHECK (rule_id ~ '^[0-9a-f]{32}$'),
  installation_id char(32) NOT NULL REFERENCES notification_installations(installation_id) ON DELETE CASCADE,
  account_link_id char(32),
  scope text NOT NULL CHECK (scope IN ('price', 'account')),
  network text NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  market_id text NOT NULL CHECK (char_length(market_id) BETWEEN 1 AND 128),
  event_type text NOT NULL CHECK (event_type IN (
    'fill', 'cancellation', 'rejection', 'margin_risk', 'liquidation_risk',
    'price_above', 'price_below', 'funding_above', 'funding_below'
  )),
  threshold text NOT NULL CHECK (threshold ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  identity_digest bytea NOT NULL CHECK (octet_length(identity_digest) = 32),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((scope = 'price' AND account_link_id IS NULL AND event_type IN ('price_above', 'price_below')) OR
         (scope = 'account' AND account_link_id IS NOT NULL AND event_type NOT IN ('price_above', 'price_below'))),
  UNIQUE (installation_id, identity_digest),
  UNIQUE (rule_id, installation_id, network),
  FOREIGN KEY (account_link_id, installation_id, network)
    REFERENCES notification_account_links(account_link_id, installation_id, network) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS notification_rules_installation_active_idx
  ON notification_rules (installation_id) WHERE active;

CREATE TABLE IF NOT EXISTS notification_event_dedupe_keys (
  event_key bytea PRIMARY KEY CHECK (octet_length(event_key) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at <= created_at + interval '7 days')
);

CREATE INDEX IF NOT EXISTS notification_dedupe_cleanup_idx
  ON notification_event_dedupe_keys (expires_at);

CREATE TABLE IF NOT EXISTS notification_alerts (
  alert_id char(32) PRIMARY KEY CHECK (alert_id ~ '^[0-9a-f]{32}$'),
  installation_id char(32) NOT NULL REFERENCES notification_installations(installation_id),
  account_link_id char(32),
  account_link_scope_id char(32) CHECK (account_link_scope_id IS NULL OR account_link_scope_id ~ '^[0-9a-f]{32}$'),
  deletion_id text CHECK (deletion_id IS NULL OR char_length(deletion_id) BETWEEN 1 AND 128),
  rule_id char(32),
  category text NOT NULL CHECK (category IN ('execution', 'risk', 'price', 'funding')),
  network text NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  route_hint text NOT NULL CHECK (char_length(route_hint) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (alert_id, installation_id, network),
  FOREIGN KEY (account_link_id, installation_id, network)
    REFERENCES notification_account_links(account_link_id, installation_id, network) ON DELETE SET NULL (account_link_id),
  FOREIGN KEY (rule_id, installation_id, network)
    REFERENCES notification_rules(rule_id, installation_id, network) ON DELETE SET NULL (rule_id)
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  outbox_id char(32) PRIMARY KEY CHECK (outbox_id ~ '^[0-9a-f]{32}$'),
  alert_id char(32) NOT NULL UNIQUE,
  installation_id char(32) NOT NULL REFERENCES notification_installations(installation_id),
  account_link_id char(32),
  account_link_scope_id char(32) CHECK (account_link_scope_id IS NULL OR account_link_scope_id ~ '^[0-9a-f]{32}$'),
  account_link_generation integer CHECK (account_link_generation IS NULL OR account_link_generation >= 0),
  deletion_id text CHECK (deletion_id IS NULL OR char_length(deletion_id) BETWEEN 1 AND 128),
  network text NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  revocation_generation integer NOT NULL CHECK (revocation_generation >= 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending', 'leased', 'provider_submission_started', 'provider_accepted',
    'provider_rejected', 'provider_outcome_unknown', 'cancelled'
  )),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (outbox_id, installation_id, network),
  UNIQUE (outbox_id, installation_id, network, revocation_generation),
  FOREIGN KEY (alert_id, installation_id, network)
    REFERENCES notification_alerts(alert_id, installation_id, network),
  FOREIGN KEY (account_link_id, installation_id, network)
    REFERENCES notification_account_links(account_link_id, installation_id, network) ON DELETE SET NULL (account_link_id)
);

CREATE INDEX IF NOT EXISTS notification_outbox_dispatch_idx
  ON notification_outbox (state, created_at);

CREATE TABLE IF NOT EXISTS notification_dispatch_permits (
  permit_id char(32) PRIMARY KEY CHECK (permit_id ~ '^[0-9a-f]{32}$'),
  outbox_id char(32) NOT NULL,
  installation_id char(32) NOT NULL REFERENCES notification_installations(installation_id),
  account_link_id char(32),
  account_link_scope_id char(32) CHECK (account_link_scope_id IS NULL OR account_link_scope_id ~ '^[0-9a-f]{32}$'),
  account_link_generation integer CHECK (account_link_generation IS NULL OR account_link_generation >= 0),
  deletion_id text CHECK (deletion_id IS NULL OR char_length(deletion_id) BETWEEN 1 AND 128),
  network text NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  revocation_generation integer NOT NULL CHECK (revocation_generation >= 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'submission_started', 'finished', 'expired')),
  expires_at timestamptz NOT NULL,
  provider_deadline_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  submission_started_at timestamptz,
  finished_at timestamptz,
  CHECK (expires_at <= created_at + interval '30 seconds'),
  CHECK (provider_deadline_at <= created_at + interval '10 seconds'),
  CHECK (provider_deadline_at <= expires_at),
  CHECK ((state IN ('submission_started', 'finished') AND submission_started_at IS NOT NULL) OR
         (state IN ('active', 'expired') AND submission_started_at IS NULL)),
  CHECK ((state = 'finished' AND finished_at IS NOT NULL) OR
         (state <> 'finished' AND finished_at IS NULL)),
  FOREIGN KEY (outbox_id, installation_id, network, revocation_generation)
    REFERENCES notification_outbox(outbox_id, installation_id, network, revocation_generation) ON DELETE CASCADE,
  FOREIGN KEY (account_link_id, installation_id, network)
    REFERENCES notification_account_links(account_link_id, installation_id, network) ON DELETE SET NULL (account_link_id)
);

CREATE INDEX IF NOT EXISTS notification_dispatch_permits_drain_idx
  ON notification_dispatch_permits (installation_id, state, provider_deadline_at);
CREATE UNIQUE INDEX IF NOT EXISTS notification_dispatch_permits_active_outbox_idx
  ON notification_dispatch_permits (outbox_id)
  WHERE state IN ('active', 'submission_started');

CREATE TABLE IF NOT EXISTS notification_provider_tickets (
  provider_ticket_id text PRIMARY KEY CHECK (char_length(provider_ticket_id) BETWEEN 1 AND 256),
  outbox_id char(32) NOT NULL REFERENCES notification_outbox(outbox_id),
  provider text NOT NULL CHECK (provider = 'expo'),
  accepted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS notification_delivery_receipts (
  receipt_id char(32) PRIMARY KEY CHECK (receipt_id ~ '^[0-9a-f]{32}$'),
  provider_ticket_id text NOT NULL REFERENCES notification_provider_tickets(provider_ticket_id),
  status text NOT NULL CHECK (status IN ('delivered', 'failed', 'unknown')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider_ticket_id, status)
);

CREATE TABLE IF NOT EXISTS notification_monitor_leases (
  lease_key text PRIMARY KEY CHECK (char_length(lease_key) BETWEEN 1 AND 256),
  owner_id text NOT NULL CHECK (char_length(owner_id) BETWEEN 1 AND 128),
  expires_at timestamptz NOT NULL,
  renewed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS notification_revocation_operations (
  operation_id char(32) PRIMARY KEY CHECK (operation_id ~ '^[0-9a-f]{32}$'),
  deletion_id text NOT NULL UNIQUE CHECK (char_length(deletion_id) BETWEEN 1 AND 128),
  scope_kind text NOT NULL CHECK (scope_kind IN ('installation', 'account_link')),
  scope_id char(32) NOT NULL CHECK (scope_id ~ '^[0-9a-f]{32}$'),
  state text NOT NULL CHECK (state IN ('draining', 'committed')),
  ledger_sequence bigint UNIQUE,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  committed_at timestamptz,
  CHECK ((state = 'draining' AND ledger_sequence IS NULL AND committed_at IS NULL) OR
         (state = 'committed' AND ledger_sequence IS NOT NULL AND committed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS notification_deletion_tombstones (
  tombstone_id char(32) PRIMARY KEY CHECK (tombstone_id ~ '^[0-9a-f]{32}$'),
  deletion_id text NOT NULL UNIQUE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('installation', 'account_link', 'push_token')),
  scope_mac bytea NOT NULL CHECK (octet_length(scope_mac) = 32),
  deletion_generation integer NOT NULL CHECK (deletion_generation > 0),
  ledger_sequence bigint NOT NULL UNIQUE CHECK (ledger_sequence > 0),
  ledger_durable_head bigint NOT NULL CHECK (ledger_durable_head >= ledger_sequence),
  key_version text NOT NULL CHECK (char_length(key_version) BETWEEN 1 AND 128),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS notification_delivery_retention_alerts_idx
  ON notification_alerts (created_at);
CREATE INDEX IF NOT EXISTS notification_delivery_retention_tickets_idx
  ON notification_provider_tickets (created_at);
CREATE INDEX IF NOT EXISTS notification_delivery_retention_receipts_idx
  ON notification_delivery_receipts (recorded_at);
