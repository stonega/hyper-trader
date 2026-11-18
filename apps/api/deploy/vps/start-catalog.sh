#!/bin/sh
set -eu

NOTIFICATION_DATABASE_URL=$(cat /run/secrets/database_url)
export NOTIFICATION_DATABASE_URL
exec bun apps/api/src/db/catalog-service-main.js
