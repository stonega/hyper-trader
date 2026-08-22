DROP INDEX IF EXISTS notification_provider_tickets_due_receipt_idx;
DROP INDEX IF EXISTS notification_outbox_leased_expiry_idx;
DROP INDEX IF EXISTS notification_dispatch_active_expiry_idx;
DROP INDEX IF EXISTS notification_dispatch_submission_deadline_idx;
DROP INDEX IF EXISTS notification_outbox_bounded_dispatch_idx;
DROP INDEX IF EXISTS notification_push_tokens_active_delivery_idx;

ALTER TABLE notification_provider_tickets
  DROP CONSTRAINT IF EXISTS notification_provider_tickets_receipt_lease_consistent,
  DROP COLUMN IF EXISTS receipt_error_code,
  DROP COLUMN IF EXISTS receipt_lease_expires_at,
  DROP COLUMN IF EXISTS receipt_lease_owner,
  DROP COLUMN IF EXISTS next_receipt_at,
  DROP COLUMN IF EXISTS receipt_attempts,
  DROP COLUMN IF EXISTS receipt_state,
  DROP COLUMN IF EXISTS token_id;

ALTER TABLE notification_monitor_leases
  DROP COLUMN IF EXISTS lease_generation;

ALTER TABLE notification_outbox
  DROP COLUMN IF EXISTS provider_error_code,
  DROP COLUMN IF EXISTS claim_attempts;

ALTER TABLE notification_push_tokens
  DROP CONSTRAINT IF EXISTS notification_push_tokens_delivery_state_consistent,
  DROP COLUMN IF EXISTS invalidated_at,
  DROP COLUMN IF EXISTS delivery_state;
