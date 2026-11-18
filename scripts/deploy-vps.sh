#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || "$1" == -* || ! "$1" =~ ^[a-zA-Z0-9_.@:-]+$ ]]; then
  echo "Usage: scripts/deploy-vps.sh <ssh-target>" >&2
  exit 1
fi

target=$1
repository_root=$(git rev-parse --show-toplevel)
cd "$repository_root"
revision=$(git rev-parse HEAD)
if [[ -n $(git status --porcelain --untracked-files=normal) ]]; then
  revision="$revision-worktree"
fi
release_name="${revision}-$(date -u +%Y%m%dT%H%M%SZ)"
release_directory="/opt/hyper-trader/releases/$release_name"
staging_directory=$(mktemp -d)
trap 'rm -rf "$staging_directory"' EXIT
chmod 755 "$staging_directory"
mkdir -p "$staging_directory/apps/api/src/db" "$staging_directory/apps/api/migrations"
bun build apps/api/src/catalog/catalog-service-main.ts --target=bun \
  --outfile="$staging_directory/apps/api/src/db/catalog-service-main.js"
cp apps/api/migrations/*.sql "$staging_directory/apps/api/migrations/"
printf '%s\n' "$revision" > "$staging_directory/REVISION"
(cd "$staging_directory" && sha256sum apps/api/src/db/catalog-service-main.js apps/api/migrations/*.sql > SHA256SUMS)

ssh -o BatchMode=yes "$target" \
  "test -f /opt/hyper-trader/deployment.env && test -f /opt/hyper-trader/secrets/database-url && mkdir -p '$release_directory' /opt/hyper-trader/deploy"
rsync -az "$staging_directory/" "$target:$release_directory/"
rsync -az apps/api/deploy/vps/ "$target:/opt/hyper-trader/deploy/"
ssh -o BatchMode=yes "$target" bash -s -- "$release_directory" <<'REMOTE'
set -euo pipefail
cd /opt/hyper-trader
previous_release=$(readlink -f current || true)
release_directory=$1
export RELEASE_DIR="$release_directory"
compose=(docker compose --env-file deployment.env -f deploy/compose.yaml)
if [[ -n $("${compose[@]}" ps -q postgres) ]]; then
  mkdir -p backups
  chmod 700 backups
  umask 077
  "${compose[@]}" exec -T postgres pg_dump -U postgres -d hyper_trader -Fc \
    < /dev/null > "backups/$(basename "$release_directory").dump"
fi
if ! "${compose[@]}" up -d --wait --wait-timeout 180; then
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    export RELEASE_DIR="$previous_release"
    "${compose[@]}" up -d --wait --wait-timeout 180
  fi
  exit 1
fi
ln -sfn "$release_directory" current.next
mv -Tf current.next current
printf 'RELEASE_DIR=%s\n' "$release_directory" > release.env
echo "Deployed $(cat current/REVISION)"
REMOTE
