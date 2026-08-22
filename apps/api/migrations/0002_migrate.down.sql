ALTER TABLE notification_account_links DROP CONSTRAINT IF EXISTS notification_account_links_recovery_pair;
ALTER TABLE notification_push_tokens DROP CONSTRAINT IF EXISTS notification_push_tokens_recovery_pair;
ALTER TABLE notification_installations DROP CONSTRAINT IF EXISTS notification_installations_recovery_pair;

UPDATE notification_service_state
SET schema_phase = 'expand', restore_state = 'blocked', mutations_enabled = false,
    monitors_enabled = false, delivery_enabled = false, updated_at = clock_timestamp()
WHERE singleton;
