# Deploying apps/api: Blue/Green vs Rolling, and Migration Order

This doc captures the deployment strategy notes for `apps/api`, including how DB migrations should be sequenced relative to the deploy.

## Strategy options

### Blue/Green
- Two full environments (blue = current, green = new). Traffic cuts over once green is verified healthy.
- Pros: instant rollback (flip traffic back to blue), no mixed-version traffic during rollout.
- Cons: requires double the infra during rollout, DB schema must be compatible with both versions simultaneously during the cutover window.

### Rolling
- Instances replaced gradually, old and new versions serve traffic side by side during the rollout.
- Pros: cheaper (no duplicate full environment), simpler infra.
- Cons: old and new API versions run concurrently against the same DB, so schema changes must be backward compatible for the whole rollout window.

## Recommended migration order (either strategy)
Because old and new code may briefly run against the same database (rolling), or the DB is shared across blue/green during cutover, migrations must be **backward compatible** with the previous API version until rollout completes:

1. **Expand**: Add new columns/tables as nullable/optional, additive only. Deploy this migration first, before any code depends on it.
2. **Deploy new API version**: New code can read/write new columns; old code ignores them safely.
3. **Backfill**: Populate new columns for existing rows if needed, out of band.
4. **Cutover**: Once the new version is fully rolled out (all instances, or blue/green traffic fully switched), deploy code that relies on the new schema being present everywhere.
5. **Contract**: In a later, separate migration, drop old columns/tables only after confirming no running code path (including rollback targets) still references them.

## Rollback notes
- Blue/Green: rollback = flip traffic back to blue. Do **not** run the "contract" migration step until you're confident you won't need to roll back to a version that depends on the old schema.
- Rolling: rollback = redeploy previous image. Same constraint — don't drop old columns until all instances are confirmed on the new version and rollback is no longer a concern.

## Open items
- [ ] Confirm which strategy (blue/green vs rolling) the current infra actually supports for `apps/api`.
- [ ] Document the specific migration tooling/commands used (Prisma migrate deploy, etc.) alongside this ordering.
