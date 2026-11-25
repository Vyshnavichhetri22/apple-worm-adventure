# Wallet System Database Migration Runbook (Phase 8)

This directory contains standalone, hardened CLI migration runners for the Apple Worm Adventure wallet integrity and accounting system.

---

## 1. Migration Sequence & Architectural Order

Migrations **must** be executed in the following sequential order. Never execute out of order:

1. **Step 1: Wallet Transaction Idempotency Key Index Migration**
   - Script: `server/scripts/migrate-wallet-idempotency-index.js`
   - Purpose: Transitions `wallettransactions` from obsolete global unique index `{ idempotencyKey: 1 }` to user-scoped compound unique partial index `{ userId: 1, idempotencyKey: 1 }` (`partialFilterExpression: { idempotencyKey: { $type: "string" } }`).
   - Prerequisite for all user-level concurrent operations.

2. **Step 2: Wallet Transaction OpId Compound Index Migration**
   - Script: `server/scripts/migrate-wallet-opid-index.js`
   - Purpose: Establishes the user-scoped compound unique partial index `{ userId: 1, opId: 1 }` on `wallettransactions` (`partialFilterExpression: { opId: { $type: "string" } }`).
   - Ensures exact-once recovery idempotency per operation ID.

3. **Step 3: Wallet Accounting Baseline Initialization**
   - Script: `server/scripts/initialize-wallet-baseline.js`
   - Purpose: Establishes authoritative monotonic baselines on legacy `wallets` documents (`sequence: 0`, `baselineBalance: wallet.balance`, `baselineSequence: 0`, `unsettledOperations: []`, `baselineEstablishedAt: Date`).
   - Requires collections and transactions indexes to already be in place.

---

## 2. Staging Environment Separation & Explicit Loading

To avoid accidental fallback to development or production configuration (such as values residing in `server/.env`), the migration tooling supports dedicated staging configuration loading.

### 2.1. Dedicated Configuration File (`.env.staging`)
A dedicated template is provided at `.env.staging.example` and `server/.env.staging.example`.
1. Copy the template to `.env.staging`:
   ```bash
   cp .env.staging.example .env.staging
   ```
2. Populate `.env.staging` with verified staging credentials.
3. `.env.staging` is strictly excluded from git via `.gitignore`. Never commit staging credentials.

### 2.2. Explicit Configuration Loading Methods
Always load staging configuration explicitly via one of the following verified methods:

#### Method A: Using the CLI `--env-file` or `--env` Flag (Recommended)
All three migration runners natively support `--env-file=<path>` and the alias `--env=<path>`:
```bash
node server/scripts/migrate-wallet-idempotency-index.js --env-file=.env.staging
node server/scripts/migrate-wallet-opid-index.js --env-file=.env.staging
node server/scripts/initialize-wallet-baseline.js --env-file=.env.staging

# Alias syntax is also supported:
node server/scripts/migrate-wallet-idempotency-index.js --env=.env.staging
```

##### CLI Argument Rules & Hardening:
- **`=` Syntax is Required**: The assignment operator `=` is strictly required (`--env-file=<path>` or `--env=<path>`). Space-separated syntax (e.g. `--env-file .env.staging` or bare `--env-file`) is strictly rejected (`UNSUPPORTED_ENV_FILE_SYNTAX`).
- **Non-Empty Path Required**: Empty paths (e.g. `--env-file=` or `--env=`) are rejected (`EMPTY_ENV_FILE_PATH`).
- **Duplicate & Conflicting Flags Prohibited**: Supplying multiple environment flags (e.g. `--env-file=a --env-file=b` or conflicting `--env-file=a --env=b`) is strictly rejected (`DUPLICATE_ENV_FILE_ARG`).
- **Unknown Arguments Rejected**: Any unrecognized flags or positional arguments (e.g. `--force`, `--drop`, `-x`, `staging`) are rejected (`UNKNOWN_ARGUMENT`).
- **Pre-Connection Validation**: All CLI argument parsing and environment loading validation runs before any database connection attempt. If validation fails, execution halts immediately with zero network activity.
- **Missing File Refusal**: If the specified environment file does not exist, the runner fails closed immediately with `ENV_FILE_NOT_FOUND` before any database connection can occur.

#### Method B: Subshell Scoped Variables
Pass variables scoped strictly to the execution command:
```bash
env MONGODB_URI="mongodb+srv://<staging_user>:<staging_pass>@<staging_host>/apple_worm_staging" \
    MIGRATION_EXPECTED_DB_NAME="apple_worm_staging" \
    MIGRATION_ALLOWED_HOSTS="<staging_host>,127.0.0.1,localhost" \
    WALLET_INTEGRITY_SECRET="<staging_secret_at_least_32_chars>" \
    node server/scripts/migrate-wallet-idempotency-index.js
```

### 2.3. Verifying Environment Variable Presence Without Exposing Values
Prior to running migration scripts, verify that all required variables are set without printing secret values to the terminal:

**In Bash / Linux / macOS:**
```bash
for var in MONGODB_URI MIGRATION_EXPECTED_DB_NAME MIGRATION_ALLOWED_HOSTS WALLET_INTEGRITY_SECRET; do
  if [ -n "${!var}" ]; then
    echo "$var: SET"
  else
    echo "$var: NOT SET"
  fi
done
```

**In PowerShell / Windows:**
```powershell
@("MONGODB_URI", "MIGRATION_EXPECTED_DB_NAME", "MIGRATION_ALLOWED_HOSTS", "WALLET_INTEGRITY_SECRET") | ForEach-Object {
    [PSCustomObject]@{
        Variable = $_
        Status   = if ([string]::IsNullOrWhiteSpace([System.Environment]::GetEnvironmentVariable($_))) { "NOT SET" } else { "SET" }
    }
}
```

---

## 3. Fail-Closed Target Validation

All migration scripts integrate `validateMigrationTarget` (`server/src/utils/validateMigrationTarget.js`) before attempting any MongoDB connection.

### Required Environment Configuration:
Before running any script, you must explicitly set both target-validation variables:

```bash
# Exact target database name (exact match required; fail-closed on mismatch)
export MIGRATION_EXPECTED_DB_NAME="apple_worm_staging"

# Approved host allowlist (comma-separated exact hostnames or hostname:port)
export MIGRATION_ALLOWED_HOSTS="cluster0.staging.mongodb.net,127.0.0.1,localhost"
```

### Target Protection Gates:
1. **URI Parsing & Credential Redaction**: Connection strings are parsed safely. Password and user credentials are scrubbed from all console output and error messages.
2. **Missing Configuration Refusal**: If either `MIGRATION_EXPECTED_DB_NAME` or `MIGRATION_ALLOWED_HOSTS` is missing, the script halts immediately with zero database calls (`MISSING_EXPECTED_DB_CONFIG` or `MISSING_ALLOWED_HOSTS_CONFIG`).
3. **Exact Database Name Match**: The database name in `MONGODB_URI` must match `MIGRATION_EXPECTED_DB_NAME` character-for-character. Loose substring matches (such as merely containing `"staging"`) are rejected (`DB_NAME_MISMATCH`).
4. **Exact Host Allowlist Check**: Every host in `MONGODB_URI` (including replica set nodes) must be present in `MIGRATION_ALLOWED_HOSTS` (`HOST_NOT_ALLOWED`).
5. **Production Rejection**: Database names matching `apple_worm_adventure`, `prod`, `production`, or production host patterns are rejected by default (`PRODUCTION_TARGET_REJECTED`). Live execution in production additionally requires both `--apply` and `--confirm-production`.

---

## 4. Dry-Run Default & `--apply` Execution

All three migration runners default strictly to **DRY-RUN (READ-ONLY)** mode:

```bash
# -----------------------------------------------------------------------------
# DRY-RUN (Preflight Inspection Only — ZERO DATABASE WRITES)
# -----------------------------------------------------------------------------
node server/scripts/migrate-wallet-idempotency-index.js --env-file=.env.staging
node server/scripts/migrate-wallet-opid-index.js --env-file=.env.staging
node server/scripts/initialize-wallet-baseline.js --env-file=.env.staging
```

Dry-run mode inspects active indexes, checks for conflicts or corruptions, scans for duplicate records, and outputs a detailed planned action report.

### Live Execution:
Live writes occur **only** when the operator explicitly provides `--apply`:

```bash
# -----------------------------------------------------------------------------
# LIVE EXECUTION (Requires --apply)
# -----------------------------------------------------------------------------
node server/scripts/migrate-wallet-idempotency-index.js --env-file=.env.staging --apply
node server/scripts/migrate-wallet-opid-index.js --env-file=.env.staging --apply
node server/scripts/initialize-wallet-baseline.js --env-file=.env.staging --apply
```

### CLI Argument Reference Matrix:

| Argument | Type | Syntax | Default | Description |
|---|---|---|---|---|
| `--apply` | Flag | Bare flag | `false` (dry-run) | Enables live mutations. When omitted, scripts perform read-only inspection. |
| `--confirm-production` | Flag | Bare flag | `false` | Mandatory confirmation when targeting production databases. |
| `--env-file=<path>` | Option | Key=Value | `null` | Loads custom environment file before target validation. |
| `--env=<path>` | Option | Key=Value | `null` | Alias for `--env-file=<path>`. |

*Note: All other flags, positional arguments, space-separated options, empty paths, and duplicate environment flags are strictly rejected.*

---

## 5. Operational Prerequisites & Quiescence

During staging or production migration execution:
- **Application Backend Quiescence**: The backend server (`server.js`) must be completely stopped or in maintenance mode (`server.close()`).
- **Recovery Scheduler Quiescence**: The background wallet recovery scheduler (`walletRecoveryService.js`) must be stopped via `drainAndStopRecovery()`.
- **Zero In-Flight Traffic**: No player transactions, gameplay sessions, or financial requests should be active.

---

## 6. Backup Creation & Verification Runbook

Prior to executing any live migration on staging or production, point-in-time archives must be generated, verified for file integrity, and validated via non-destructive restore testing.

### 6.1. Required Collection Scope
The migration strictly affects financial accounting and player balances. Point-in-time archives must capture:
1. `wallets`: Current balance, monotonic sequences, unsettled operations, and baseline metadata.
2. `wallettransactions`: Immutable transaction ledger and idempotency keys.
3. `users`: Cached coin values and sequence synchronization watermarks.

### 6.2. Archive Creation Procedure (Do Not Execute In Audit Mode)
Execute collection-level exports into timestamped archive files:
```bash
BACKUP_TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mongodump --uri="$MONGODB_URI" --collection=wallets --archive="staging_backup_wallets_${BACKUP_TIMESTAMP}.archive"
mongodump --uri="$MONGODB_URI" --collection=wallettransactions --archive="staging_backup_wallettransactions_${BACKUP_TIMESTAMP}.archive"
mongodump --uri="$MONGODB_URI" --collection=users --archive="staging_backup_users_${BACKUP_TIMESTAMP}.archive"
```

### 6.3. Archive Existence & Size Verification
Confirm that all archive files were successfully created and possess a non-zero byte size:
```bash
# Verify file existence and non-empty sizes
ls -lh staging_backup_*_${BACKUP_TIMESTAMP}.archive

# Ensure each archive size is > 0 bytes
for f in staging_backup_*_${BACKUP_TIMESTAMP}.archive; do
  [ -s "$f" ] && echo "VERIFIED (non-empty): $f" || (echo "FAILED: $f is empty or missing" && exit 1)
done
```

### 6.4. Archive Stream Integrity Check
Validate the internal BSON stream structure without extracting files to disk using `bsondump`:
```bash
bsondump --archive="staging_backup_wallets_${BACKUP_TIMESTAMP}.archive" --quiet > /dev/null && echo "Wallets archive stream valid"
bsondump --archive="staging_backup_wallettransactions_${BACKUP_TIMESTAMP}.archive" --quiet > /dev/null && echo "Transactions archive stream valid"
bsondump --archive="staging_backup_users_${BACKUP_TIMESTAMP}.archive" --quiet > /dev/null && echo "Users archive stream valid"
```

### 6.5. Isolated Restore Validation (Temporary Namespace)
To prove that archives can be restored without altering active staging data or using production credentials:
1. Restore archives into a temporary verification namespace (`staging_restore_verification_temp`):
   ```bash
   mongorestore --uri="$MONGODB_URI" \
     --archive="staging_backup_wallets_${BACKUP_TIMESTAMP}.archive" \
     --nsInclude="apple_worm_staging.wallets" \
     --nsRename="apple_worm_staging.wallets:staging_restore_verification_temp.wallets"
   ```
2. Verify document counts match between active collection and temporary verification collection:
   ```javascript
   // In MongoDB shell connected to staging
   const originalCount = db.getSiblingDB("apple_worm_staging").wallets.countDocuments();
   const tempCount = db.getSiblingDB("staging_restore_verification_temp").wallets.countDocuments();
   if (originalCount !== tempCount) throw new Error("Backup validation count mismatch!");
   console.log(`Verified restore integrity: ${tempCount} documents matched.`);
   ```
3. Immediately clean up the temporary verification database:
   ```javascript
   db.getSiblingDB("staging_restore_verification_temp").dropDatabase();
   ```

### 6.6. Human Approval Gate
The Operator and Lead Developer must sign off on the backup verification log before proceeding to Step 4 live `--apply` operations.

### 6.7. Strict Prohibition of Blanket `mongorestore --drop`
> [!CAUTION]
> **Routine use of blanket `mongorestore --drop` is strictly prohibited.**
> Blanket drops destroy collections indiscriminately, wipe newly created indexes, and can cause catastrophic data loss if executed against the wrong environment.
> If rollback is required, perform granular index reversal or targeted collection restores into temporary namespaces.

### 6.8. Backup Artifact Version Control Protection
Backup archives contain raw database records and must never be committed to Git.
The repository root `.gitignore` automatically excludes all database backup and dump artifacts:
- `*.archive` (MongoDB archive dumps, e.g. `staging_backup_wallets_*.archive`)
- `*.dump` (Binary database dumps)
- `*.bson` (BSON collection dumps)
- `*.metadata.json` (MongoDB collection metadata files)
- `dump/` (Default `mongodump` directory output)

Operators must store point-in-time archives in secure, access-controlled cloud storage or encrypted offline volumes outside version control.

---

## 7. Granular Recovery & Rollback Runbook

If a migration fails, is aborted, or is interrupted, follow the specific recovery procedures below. Never destroy collections blindly.

### 7.1. Idempotency Index Migration Failure
- **Failure Before Verification**:
  - The script is non-destructive. If compound index creation fails, the obsolete global index `idempotencyKey_1` is preserved.
  - Check error log for root cause (e.g. index build timeout or malformed documents).
- **Compound Created but Global Drop Failed**:
  - Compound index `{ userId: 1, idempotencyKey: 1 }` is verified active.
  - The obsolete global index can be manually removed:
    ```javascript
    db.wallettransactions.dropIndex("idempotencyKey_1");
    ```
- **Manual Rollback to Global Index (Emergency Reversal)**:
  - Create the global index first before dropping the compound index:
    ```javascript
    db.wallettransactions.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true, name: "idempotencyKey_1" });
    db.wallettransactions.dropIndex("userId_1_idempotencyKey_1");
    ```

### 7.2. OpId Compound Index Migration Failure
- **Failure Before Verification**:
  - No indexes were dropped; database state is preserved.
- **Manual Rollback**:
  - If the opId index needs to be removed:
    ```javascript
    db.wallettransactions.dropIndex("userId_1_opId_1");
    ```

### 7.3. Baseline Initialization Failure & Concurrency Conflicts
- **Partial Failure in Batch**:
  - Baseline initialization uses atomic conditional `$set` with optimistic concurrency guard `balance: wallet.balance`.
  - Wallets updated before failure have valid monotonic baselines (`sequence: 0`, `baselineBalance: balance`, `baselineSequence: 0`).
  - Wallets not yet updated remain legacy uninitialized.
  - The script is **100% idempotent**: rerunning `initialize-wallet-baseline.js --apply` will detect already-initialized wallets and only apply baselines to the remaining uninitialized wallets.
- **Concurrency Conflicts (`concurrencyConflicts > 0`)**:
  - Indicates a concurrent process modified a wallet's balance during migration.
  - Re-verify quiescence (ensure all backend servers and recovery workers are stopped).
  - Rerun `initialize-wallet-baseline.js --apply`.

### 7.4. Duplicate Historical Records Detected
- If `findDuplicateHistoricalIdempotencyRecords` or `findDuplicateHistoricalOpIdRecords` reports duplicates:
  - The migration halts immediately with zero writes.
  - Locate the duplicate records using the aggregation query output in the error message.
  - Investigate transaction provenance, retain the authoritative record, and resolve duplicates under database audit logging.
  - Never execute blanket deletes.

### 7.5. Interrupted Migration (Process Killed or Network Disconnected)
- Rerun the runner in dry-run mode (`without --apply`).
- Inspect the preflight report:
  - If `alreadyExists: true` or `alreadyInitialized: totalScanned`, the migration completed before interruption.
  - If `plannedAction` indicates remaining work, re-execute with `--apply` once network stability is restored.

### 7.6. Disaster Recovery via Backup (Targeted Restore Only)
If catastrophic corruption occurs:
1. Never use `--drop` on the target database.
2. Restore the specific affected collection archive into an isolated temporary staging database (`staging_recovery_temp`).
3. Verify the restored data in `staging_recovery_temp`.
4. Perform an atomic collection rename or targeted document merge under senior engineering supervision.

---

## 8. Staging Authorization Gate

Staging database execution is not permitted without explicit authorization and verified staging credentials.
Do not proceed to staging execution or production cutover until authorized by the project lead.
