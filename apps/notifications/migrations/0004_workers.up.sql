ALTER TABLE notification_push_tokens
  ADD COLUMN delivery_state text NOT NULL DEFAULT 'active'
    CHECK (delivery_state IN ('active', 'invalid')),
  ADD COLUMN invalidated_at timestamptz,
  ADD CONSTRAINT notification_push_tokens_delivery_state_consistent
    CHECK ((delivery_state = 'active' AND invalidated_at IS NULL) OR
           (delivery_state = 'invalid' AND invalidated_at IS NOT NULL));

ALTER TABLE notification_outbox
  ADD COLUMN claim_attempts integer NOT NULL DEFAULT 0
    CHECK (claim_attempts BETWEEN 0 AND 8),
  ADD COLUMN provider_error_code text
    CHECK (provider_error_code IS NULL OR
           char_length(provider_error_code) BETWEEN 1 AND 64);

ALTER TABLE notification_monitor_leases
  ADD COLUMN lease_generation integer NOT NULL DEFAULT 1
    CHECK (lease_generation > 0);

ALTER TABLE notification_provider_tickets
  ADD COLUMN token_id char(32)
    REFERENCES notification_push_tokens(token_id) ON DELETE SET NULL,
  ADD COLUMN receipt_state text NOT NULL DEFAULT 'pending'
    CHECK (receipt_state IN ('pending', 'delivered', 'failed', 'unknown')),
  ADD COLUMN receipt_attempts integer NOT NULL DEFAULT 0
    CHECK (receipt_attempts BETWEEN 0 AND 5),
  ADD COLUMN next_receipt_at timestamptz,
  ADD COLUMN receipt_lease_owner text
    CHECK (receipt_lease_owner IS NULL OR
           char_length(receipt_lease_owner) BETWEEN 1 AND 128),
  ADD COLUMN receipt_lease_expires_at timestamptz,
  ADD COLUMN receipt_error_code text
    CHECK (receipt_error_code IS NULL OR
           char_length(receipt_error_code) BETWEEN 1 AND 64);

UPDATE notification_provider_tickets
SET next_receipt_at = accepted_at + interval '15 minutes'
WHERE next_receipt_at IS NULL;

ALTER TABLE notification_provider_tickets
  ALTER COLUMN next_receipt_at SET NOT NULL,
  ADD CONSTRAINT notification_provider_tickets_receipt_lease_consistent
    CHECK ((receipt_lease_owner IS NULL) = (receipt_lease_expires_at IS NULL));

CREATE INDEX notification_push_tokens_active_delivery_idx
  ON notification_push_tokens (installation_id, provider)
  WHERE delivery_state = 'active';

CREATE INDEX notification_outbox_bounded_dispatch_idx
  ON notification_outbox (state, created_at)
  WHERE state = 'pending' AND claim_attempts < 8;

CREATE INDEX notification_dispatch_submission_deadline_idx
  ON notification_dispatch_permits (provider_deadline_at)
  WHERE state = 'submission_started';

CREATE INDEX notification_dispatch_active_expiry_idx
  ON notification_dispatch_permits (expires_at)
  WHERE state = 'active';

CREATE INDEX notification_outbox_leased_expiry_idx
  ON notification_outbox (lease_expires_at)
  WHERE state = 'leased';

CREATE INDEX notification_provider_tickets_due_receipt_idx
  ON notification_provider_tickets (next_receipt_at, accepted_at)
  WHERE receipt_state = 'pending' AND receipt_attempts < 5;
