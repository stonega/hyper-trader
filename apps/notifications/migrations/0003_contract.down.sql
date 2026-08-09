UPDATE notification_service_state
SET schema_phase = 'migrated', restore_state = 'blocked', mutations_enabled = false,
    monitors_enabled = false, delivery_enabled = false, updated_at = clock_timestamp()
WHERE singleton;

ALTER TABLE notification_account_links ALTER COLUMN recovery_key_version DROP NOT NULL;
ALTER TABLE notification_account_links ALTER COLUMN recovery_scope_mac DROP NOT NULL;
ALTER TABLE notification_push_tokens ALTER COLUMN wrapped_dek DROP NOT NULL;
ALTER TABLE notification_push_tokens ALTER COLUMN recovery_key_version DROP NOT NULL;
ALTER TABLE notification_push_tokens ALTER COLUMN recovery_scope_mac DROP NOT NULL;
ALTER TABLE notification_installations ALTER COLUMN recovery_key_version DROP NOT NULL;
ALTER TABLE notification_installations ALTER COLUMN recovery_scope_mac DROP NOT NULL;
