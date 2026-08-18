ALTER TABLE notification_installations VALIDATE CONSTRAINT notification_installations_recovery_pair;
ALTER TABLE notification_push_tokens VALIDATE CONSTRAINT notification_push_tokens_recovery_pair;
ALTER TABLE notification_account_links VALIDATE CONSTRAINT notification_account_links_recovery_pair;

ALTER TABLE notification_installations
  ALTER COLUMN recovery_scope_mac SET NOT NULL,
  ALTER COLUMN recovery_key_version SET NOT NULL;
ALTER TABLE notification_push_tokens
  ALTER COLUMN recovery_scope_mac SET NOT NULL,
  ALTER COLUMN recovery_key_version SET NOT NULL,
  ALTER COLUMN wrapped_dek SET NOT NULL;
ALTER TABLE notification_account_links
  ALTER COLUMN recovery_scope_mac SET NOT NULL,
  ALTER COLUMN recovery_key_version SET NOT NULL;

UPDATE notification_service_state
SET schema_phase = 'contracted', updated_at = clock_timestamp()
WHERE singleton;
