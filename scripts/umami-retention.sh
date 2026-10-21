#!/usr/bin/env bash
# Umami retention for stats.tenspla.cat: deletes usage statistics older than 24 months, as the privacy policy
# promises. Self-hosted Umami never deletes anything by itself.
#
# Runs on the production server, where Umami's PostgreSQL lives in the Docker container `umami-db`
# (database and user `umami`). Dry run by default: it only counts what it would delete.
#
#   bash scripts/umami-retention.sh                    # dry run
#   bash scripts/umami-retention.sh --apply            # delete older than 24 months, in one transaction
#   bash scripts/umami-retention.sh --clear-click-ids  # dry run of blanking fbclid, gclid… already stored
#   bash scripts/umami-retention.sh --clear-click-ids --apply
#
# Options: --months N (default 24), --container NAME (default umami-db).
set -euo pipefail

MONTHS=24
CONTAINER=umami-db
APPLY=0
CLEAR_CLICK_IDS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --clear-click-ids) CLEAR_CLICK_IDS=1 ;;
    --months) MONTHS="$2"; shift ;;
    --container) CONTAINER="$2"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$MONTHS" in
  ''|*[!0-9]*) echo "--months must be a whole number" >&2; exit 2 ;;
esac
if [ "$MONTHS" -lt 1 ]; then echo "--months must be at least 1" >&2; exit 2; fi

psql_umami() {
  docker exec -i "$CONTAINER" psql -U umami -d umami -v ON_ERROR_STOP=1 -At "$@"
}

CUTOFF="now() - interval '${MONTHS} months'"
CLICK_ID_COLUMNS="fbclid, gclid, li_fat_id, msclkid, ttclid, twclid"
CLICK_ID_FILTER="fbclid IS NOT NULL OR gclid IS NOT NULL OR li_fat_id IS NOT NULL OR msclkid IS NOT NULL OR ttclid IS NOT NULL OR twclid IS NOT NULL"

if [ "$CLEAR_CLICK_IDS" -eq 1 ]; then
  echo "[umami-retention] events with stored click identifiers:"
  psql_umami -c "SELECT count(*) FROM website_event WHERE ${CLICK_ID_FILTER};"
  if [ "$APPLY" -eq 1 ]; then
    psql_umami -c "SET lock_timeout = '30s';" -c "UPDATE website_event SET (${CLICK_ID_COLUMNS}) = (NULL, NULL, NULL, NULL, NULL, NULL) WHERE ${CLICK_ID_FILTER};"
    echo "[umami-retention] click identifiers cleared"
  else
    echo "[umami-retention] dry run: nothing changed (add --apply)"
  fi
  exit 0
fi

echo "[umami-retention] rows older than ${MONTHS} months:"
psql_umami <<SQL
SELECT 'website_event', count(*) FROM website_event WHERE created_at < ${CUTOFF};
SELECT 'event_data', count(*) FROM event_data WHERE created_at < ${CUTOFF};
SELECT 'session_data', count(*) FROM session_data WHERE created_at < ${CUTOFF};
SELECT 'session (without newer events)', count(*) FROM session s
  WHERE s.created_at < ${CUTOFF}
    AND NOT EXISTS (SELECT 1 FROM website_event e WHERE e.session_id = s.session_id AND e.created_at >= ${CUTOFF});
SQL

if [ "$APPLY" -ne 1 ]; then
  echo "[umami-retention] dry run: nothing deleted (add --apply)"
  exit 0
fi

psql_umami <<SQL
BEGIN;
-- Give up instead of waiting forever if Umami is holding a lock; the next run retries.
SET LOCAL lock_timeout = '30s';
DELETE FROM event_data WHERE created_at < ${CUTOFF};
DELETE FROM session_data WHERE created_at < ${CUTOFF};
DELETE FROM website_event WHERE created_at < ${CUTOFF};
DELETE FROM session s
  WHERE s.created_at < ${CUTOFF}
    AND NOT EXISTS (SELECT 1 FROM website_event e WHERE e.session_id = s.session_id);
COMMIT;
SQL
echo "[umami-retention] deleted statistics older than ${MONTHS} months"
