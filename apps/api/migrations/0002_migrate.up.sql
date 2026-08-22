UPDATE notification_service_state
SET schema_phase = 'migrated', updated_at = clock_timestamp()
WHERE singleton;

ALTER TABLE notification_installations
  ADD CONSTRAINT notification_installations_recovery_pair
  CHECK ((recovery_scope_mac IS NULL) = (recovery_key_version IS NULL)) NOT VALID;
ALTER TABLE notification_push_tokens
  ADD CONSTRAINT notification_push_tokens_recovery_pair
  CHECK ((recovery_scope_mac IS NULL) = (recovery_key_version IS NULL)) NOT VALID;
ALTER TABLE notification_account_links
  ADD CONSTRAINT notification_account_links_recovery_pair
  CHECK ((recovery_scope_mac IS NULL) = (recovery_key_version IS NULL)) NOT VALID;
