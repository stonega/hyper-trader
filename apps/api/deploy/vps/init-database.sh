#!/bin/sh
set -eu

app_password=$(cat /run/secrets/app_password)
psql --username "$POSTGRES_USER" --dbname postgres \
  --set=ON_ERROR_STOP=1 --set=app_password="$app_password" <<'SQL'
CREATE ROLE hyper_trader LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE hyper_trader OWNER hyper_trader;
SQL
