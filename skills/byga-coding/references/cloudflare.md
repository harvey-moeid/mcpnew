# Cloudflare and data workflows

## Deploy Workers/Pages
- Confirm exact account, service name, branch, staging/production, routes/domains, runtime compatibility and wrangler config.
- Inspect D1/R2/KV/Durable Objects bindings, cron triggers, environment variables **names**, Access protections, origins, migrations and release approach.
- Verify actual tool permissions and deployment source. Don't expose secret values.
- Confirm runtime build/lint, safe schema compatibility, backups and rollback notes for high impact.
- After deploy check deploy ID, endpoint/health route, logs and core request flow. Passing build != live success.

## D1 writes/reads audit
1. Establish baseline by date and time window (Cloudflare metrics/logs), identify whether reported metric is rows written, queries or another unit. Never conflate them.
2. Enumerate writers: cron, HTTP API, retry, webhook, migrations, backfill, background jobs, tests.
3. Attribute each writer to frequency × symbols × candle frames × expected rows × duplicate rate. Mark estimates explicitly.
4. Check `UPSERT` semantically, update-on-unchanged-row, indexes, bulk writes, queue retries, cron overlap and per-symbol backfill toggles.
5. Optimize idempotency, update-when-changed, stable cursor/checkpoint, cache and batch after preserving data invariants.
6. Verify before/after metrics, stale-candle risks, no missing updates, full rollback including state format changes.

## Storage split
- D1: relational data, consistent metadata, indexed lookups, transactions as platform provides.
- R2: larger JSON/media objects, snapshots, histories and archival.
- KV: non-critical cache/lookup with eventual consistency; not a transactional ledger.
- Minimize D1 operations with actual evidence, never by disabling required ingest or risking data loss.

## Cron + realtime safety
- Prevent overlapping poll/backfill via explicit control appropriate to infra; don't assume in-memory lock works across Workers instances.
- Dedup event IDs and candle-close keys; use bounded retry with jitter and DLQ where offered.
- Account for 5-minute cadence only when verified in repo; do not hardcode schedule assumptions.
