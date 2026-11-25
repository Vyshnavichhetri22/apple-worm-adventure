# Apple Worm Adventure — Production Migration & Operations Runbook

**Environment Target**: MongoDB Atlas Production  
**Production Database**: `apple_worm_adventure`  
**Phase**: Phase 8 Step 5C — Production Operations & Cutover  
**Document Classification**: Confidential — Operator Procedures  

---

## 1. Safety Invariants & Rules of Engagement

1. **Strict Target Validation**:
   - Every migration tool uses pre-connection fail-closed validation ([`server/src/utils/validateMigrationTarget.js`](../server/src/utils/validateMigrationTarget.js)).
   - Target database must match `apple_worm_adventure` character-for-character. Substring matching is strictly rejected.
   - Every host in the connection URI must be present in `MIGRATION_ALLOWED_HOSTS`.
   - Production execution strictly requires both `--apply` and `--confirm-production` CLI flags.
2. **Account Separation**:
   - Never use the production runtime credentials to run migrations.
   - The Migration Operator account must have `readWrite` and `dbAdmin` restricted to `apple_worm_adventure` only.
   - Never use `admin`, `root`, or cluster-wide administrative credentials.
3. **Quiescence**:
   - Zero application traffic and zero in-flight operations during migration.
   - All backend instances and background recovery workers must be stopped before starting migration scripts.
4. **Credential Redaction & Protection**:
   - Never commit environment files (`.env.production*`).
   - All connection strings printed by migration tooling automatically mask credentials as `***:***@`.
5. **No Blanket Database Drops**:
   - Blanket `mongorestore --drop` against production is strictly prohibited.
   - Rollbacks must be granular and non-destructive.

---

## 2. Prerequisites & Preparation

### 2.1. Tooling Requirements
Verify required tools are available in the operator's execution environment:
- **Node.js**: v18.0.0 or higher (`node -v`)
- **MongoDB Database Tools**: v100.20.1 or higher (`mongodump --version`, `mongorestore --version`, `bsondump --version`)
- **Git**: Clean working directory on release commit/tag

### 2.2. Atlas Network Allowlist
1. Identify the operator's current public IP address.
2. In MongoDB Atlas, add the operator's IP to the Network Access IP Access List with a temporary comment (e.g. `Maintenance Operator - 2026-11-24`).
3. **Never allow `0.0.0.0/0`**.

### 2.3. Environment Configuration Template (`server/.env.production.operator`)
Create `server/.env.production.operator` (strictly gitignored):

```ini
# Production Migration Operator Configuration
NODE_ENV=production
PORT=5000
GAME_NAME=APPLE WORM ADVENTURE

# Dedicated Operator Database Connection String (readWrite + dbAdmin on apple_worm_adventure only)
MONGODB_URI=mongodb+srv://<operator_username>:<operator_password>@<prod_cluster>.mongodb.net/apple_worm_adventure?retryWrites=true&w=majority

# Target Validation Gates (Exact Match Required)
MIGRATION_EXPECTED_DB_NAME=apple_worm_adventure
MIGRATION_ALLOWED_HOSTS=<prod_cluster>.mongodb.net,127.0.0.1,localhost

# Wallet Integrity Secret (Must be >= 32 characters in production)
WALLET_INTEGRITY_SECRET=replace_with_secure_production_secret_at_least_32_characters_long

# Recovery Schedulers (Disabled during migration)
WALLET_RECOVERY_INTERVAL_MS=60000
WALLET_RECOVERY_BATCH_SIZE=50
WALLET_CACHE_RECONCILIATION_BATCH_SIZE=100
```

Verify that the file is excluded from Git:
```powershell
git status --ignored
```
*(Confirm `server/.env.production.operator` is in the Ignored files section.)*

---

## 3. Quiescence & Pre-Migration Shutdown

1. **Drain and Stop Application Backend**:
   - In production host/container environment, issue `SIGTERM` to the backend process.
   - The application executes `gracefulShutdown()`:
     - Drains background recovery scheduler with 10s bounded timeout.
     - Closes HTTP listener.
     - Closes MongoDB client connections cleanly.
2. **Confirm Zero Traffic**:
   - Verify zero active incoming HTTP connections on load balancer or reverse proxy.
   - Verify zero active operations in MongoDB Atlas Metrics for `apple_worm_adventure`.

---

## 4. Production Database Backup Procedure

Before applying any schema or index changes, create a point-in-time database-level archive:

### 4.1. Create Archive Backup
```powershell
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "server\production-backups\prod_backup_apple_worm_adventure_$ts.archive"

# Ensure backup directory exists
New-Item -ItemType Directory -Force -Path "server\production-backups"

# Execute full database archive
mongodump --uri="$env:MONGODB_URI" --archive="$backupFile"
```

### 4.2. Verify Archive Size and Stream Integrity
```powershell
# 1. Verify file exists and has non-zero size
$item = Get-Item $backupFile
if ($item.Length -le 1000) {
    throw "Backup failed: Archive is empty or suspiciously small ($($item.Length) bytes)."
}
Write-Host "Backup created: $backupFile ($([math]::Round($item.Length/1MB, 2)) MB)"

# 2. Verify BSON stream integrity using dry-run restore
mongorestore --archive="$backupFile" --dryRun
```

### 4.3. Non-Destructive Restore Test (Temporary Verification Namespace)
To prove that the archive can be restored without modifying `apple_worm_adventure`:
```powershell
mongorestore --uri="$env:MONGODB_URI" `
  --archive="$backupFile" `
  --nsInclude="apple_worm_adventure.*" `
  --nsRename="apple_worm_adventure.*:prod_restore_verify_temp.*"
```

Verify document counts match between source and temporary namespace, then drop temporary verification database:
```javascript
// In mongosh connected to cluster:
db.getSiblingDB("prod_restore_verify_temp").dropDatabase();
```

---

## 5. Dry-Run Preflight Inspection (Zero Writes)

Run all 4 migration and seeding runners in dry-run mode using `--env-file=server/.env.production.operator`:

```powershell
# 1. Inspect Wallet Idempotency Index
node server/scripts/migrate-wallet-idempotency-index.js --env-file=server/.env.production.operator

# 2. Inspect Wallet OpId Index
node server/scripts/migrate-wallet-opid-index.js --env-file=server/.env.production.operator

# 3. Inspect Wallet Accounting Baseline
node server/scripts/initialize-wallet-baseline.js --env-file=server/.env.production.operator

# 4. Inspect Level Seeding
node server/seed-levels.js --env-file=server/.env.production.operator
```

### Dry-Run Verification Checklist:
- [ ] `migrate-wallet-idempotency-index.js`: Planned action indicates `CREATE_COMPOUND_AND_DROP_GLOBAL` or `INDEX_ALREADY_MIGRATED`. 0 duplicate historical records detected.
- [ ] `migrate-wallet-opid-index.js`: Planned action indicates `CREATE_COMPOUND` or `INDEX_ALREADY_EXISTS`. 0 duplicate historical records detected.
- [ ] `initialize-wallet-baseline.js`: 0 wallets classified as `CORRUPTED`. Planned baselines match expected wallet counts.
- [ ] `seed-levels.js`: All 50 levels verified against schema and BFS reachability. 0 failures.

---

## 6. Formal Human Approval Gate

Before executing live mutations, the operator and lead developer must review and sign off:
- [ ] Full production backup verified and confirmed valid.
- [ ] Dry-run preflight inspection completed with 0 errors, 0 duplicates, and 0 corruptions.
- [ ] Quiescence confirmed (backend offline, zero client traffic).

---

## 7. Live Migration Execution Runbook

Execute migrations in strict sequential order. **Both `--apply` and `--confirm-production` are mandatory.**

### Step 7.1: Migrate Wallet Idempotency Key Index
```powershell
node server/scripts/migrate-wallet-idempotency-index.js --env-file=server/.env.production.operator --apply --confirm-production
```
*Expected Result*: Compound index `userId_1_idempotencyKey_1` created and verified; obsolete index `idempotencyKey_1` dropped.

### Step 7.2: Migrate Wallet OpId Index
```powershell
node server/scripts/migrate-wallet-opid-index.js --env-file=server/.env.production.operator --apply --confirm-production
```
*Expected Result*: Compound index `userId_1_opId_1` created and verified.

### Step 7.3: Initialize Wallet Accounting Baselines
```powershell
node server/scripts/initialize-wallet-baseline.js --env-file=server/.env.production.operator --apply --confirm-production
```
*Expected Result*: Baselines established on all uninitialized wallets (`sequence: 0`, `baselineBalance`, `baselineSequence: 0`, `unsettledOperations: []`). `concurrencyConflicts: 0`.

### Step 7.4: Seed Game Levels (50 Levels)
```powershell
node server/seed-levels.js --env-file=server/.env.production.operator --apply --confirm-production
```
*Expected Result*: Inserts missing levels, skips existing levels. Zero failures.

---

## 8. Post-Migration Verification

### Step 8.1: Run Level Catalog Verification
```powershell
node server/verify-seeded-levels.js --env-file=server/.env.production.operator --confirm-production
```
*Expected Result*: `50/50 levels verified active and playable across all 5 difficulty bands`.

### Step 8.2: Database Index & Baseline Audit (mongosh)
Execute read-only audit in `mongosh`:
```javascript
const db = db.getSiblingDB("apple_worm_adventure");

// 1. Audit wallettransactions indexes
const txIndexes = db.wallettransactions.getIndexes();
printjson(txIndexes.map(i => ({ name: i.name, key: i.key, unique: i.unique })));

// Assert required indexes exist
const hasIdemp = txIndexes.some(i => i.name === "userId_1_idempotencyKey_1" && i.unique === true);
const hasOpId = txIndexes.some(i => i.name === "userId_1_opId_1" && i.unique === true);
const hasOldIdemp = txIndexes.some(i => i.name === "idempotencyKey_1");

print(`Compound Idempotency Index Active : ${hasIdemp}`);
print(`Compound OpId Index Active        : ${hasOpId}`);
print(`Legacy Global Index Removed       : ${!hasOldIdemp}`);

// 2. Audit level count
print(`Total Active Levels: ${db.levels.countDocuments({ isActive: true })} (expected: 50)`);
```

---

## 9. Application Deployment & Traffic Resumption

1. **Configure Production Runtime Environment**:
   Ensure `server/.env.production` (or production container secret store) contains:
   - `NODE_ENV=production`
   - `MONGODB_URI` (runtime application user: `readWrite` on `apple_worm_adventure` only)
   - `WALLET_INTEGRITY_SECRET` (>= 32 characters, matching operator secret)
   - `JWT_SECRET`
2. **Start Production Backend Service**:
   ```bash
   node src/server.js
   ```
3. **Verify Health Endpoint**:
   ```powershell
   curl -i http://localhost:5000/api/health
   ```
   *Expected Response*: `HTTP/1.1 200 OK` `{ "status": "healthy", ... }`.
4. **Resume Traffic**:
   - Re-enable load balancer / reverse proxy routing.
   - Monitor live error logs for 15 minutes.
   - Verify `[WalletRecovery]` background worker log entries.

---

## 10. Abort & Recovery Procedures

### 10.1. Abort Conditions
Halt migration immediately if:
- `validateMigrationTarget` reports `DB_NAME_MISMATCH` or `HOST_NOT_ALLOWED`.
- `findDuplicateHistoricalIdempotencyRecords` or `findDuplicateHistoricalOpIdRecords` detects duplicate keys.
- `classifyWalletState` detects any `CORRUPTED` wallet documents.
- Any network disconnection occurs during index creation.

### 10.2. Recovery Actions
- **Interrupted Index Migration**:
  - Re-run runner without `--apply` to inspect index status.
  - If compound index exists and is valid, re-run with `--apply --confirm-production` to complete drop of obsolete global index.
- **Emergency Index Reversal**:
  ```javascript
  // If compound index must be reverted:
  db.wallettransactions.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: "idempotencyKey_1" });
  db.wallettransactions.dropIndex("userId_1_idempotencyKey_1");
  ```
- **Disaster Recovery (Targeted Restore Only)**:
  - Never use `--drop` on `apple_worm_adventure`.
  - Restore specific collection into temporary recovery database (`prod_recovery_temp`).
  - Merge or replace affected documents under senior DBA supervision.
