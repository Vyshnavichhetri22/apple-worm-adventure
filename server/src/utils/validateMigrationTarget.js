/**
 * server/src/utils/validateMigrationTarget.js
 * 
 * Fail-closed database target validation for migration scripts and operational tooling.
 * Strictly verifies target MongoDB connection strings against explicit staging allowlists
 * and rejects production targets before any network connection is attempted.
 * 
 * Safety invariants:
 *   - Fails closed if validation configuration is missing or incomplete.
 *   - Performs exact equality checks for database names (never loose substrings like .includes('staging')).
 *   - Performs strict allowlist matching for all target hosts.
 *   - Rejects production targets by default (even if NODE_ENV is set to development or staging).
 *   - Never prints, logs, or returns unredacted credentials or complete secret URIs.
 *   - Pure in-memory validation; executes with zero network and zero database access.
 */

// Well-known production database names that are strictly forbidden by default
const FORBIDDEN_PROD_DB_NAMES = new Set([
  'apple_worm_adventure',
  'apple_worm_prod',
  'apple_worm_adventure_prod',
  'apple_worm_adventure_production',
  'production',
  'prod',
]);

/**
 * Safely parses a MongoDB connection string into its components.
 * Supports standard mongodb://, mongodb+srv://, replica sets, IPv6, and credentials.
 * 
 * @param {string} uri - MongoDB connection string
 * @returns {object} Parsed components or failure details
 */
export function parseMongoUri(uri) {
  if (!uri || typeof uri !== 'string') {
    return { valid: false, error: 'URI must be a non-empty string' };
  }

  const trimmed = uri.trim();
  let protocol = null;
  let rest = null;

  if (trimmed.startsWith('mongodb://')) {
    protocol = 'mongodb';
    rest = trimmed.slice('mongodb://'.length);
  } else if (trimmed.startsWith('mongodb+srv://')) {
    protocol = 'mongodb+srv';
    rest = trimmed.slice('mongodb+srv://'.length);
  } else {
    return { valid: false, error: 'URI must begin with "mongodb://" or "mongodb+srv://"' };
  }

  // Split rest into authority/host part and path/query part
  const slashIdx = rest.indexOf('/');
  const questionIdx = rest.indexOf('?');
  let hostAndAuth = '';
  let pathAndQuery = '';

  let splitIdx = -1;
  if (slashIdx !== -1 && questionIdx !== -1) {
    splitIdx = Math.min(slashIdx, questionIdx);
  } else if (slashIdx !== -1) {
    splitIdx = slashIdx;
  } else if (questionIdx !== -1) {
    splitIdx = questionIdx;
  }

  if (splitIdx === -1) {
    hostAndAuth = rest;
    pathAndQuery = '';
  } else {
    hostAndAuth = rest.slice(0, splitIdx);
    pathAndQuery = rest.slice(splitIdx);
  }

  if (!hostAndAuth) {
    return { valid: false, error: 'URI contains no host or authority' };
  }

  // Auth separator: the last '@' in hostAndAuth separates user:pass from hosts
  const atIdx = hostAndAuth.lastIndexOf('@');
  let hasAuth = false;
  let hostString = hostAndAuth;
  if (atIdx !== -1) {
    hasAuth = true;
    hostString = hostAndAuth.slice(atIdx + 1);
  }

  if (!hostString || hostString.trim().length === 0) {
    return { valid: false, error: 'URI contains no host' };
  }

  // Split comma-separated hosts (replica set)
  const hostEntries = hostString.split(',').map((h) => h.trim()).filter(Boolean);
  if (hostEntries.length === 0) {
    return { valid: false, error: 'URI contains no valid host entries' };
  }

  const hosts = [];
  const hostnames = [];
  for (const entry of hostEntries) {
    hosts.push(entry);
    let hostOnly = entry;
    if (hostOnly.startsWith('[')) {
      // IPv6 address in brackets: [::1]:27017
      const closingBracket = hostOnly.indexOf(']');
      if (closingBracket !== -1) {
        hostOnly = hostOnly.slice(1, closingBracket);
      }
    } else {
      hostOnly = hostOnly.replace(/:\d+$/, '');
    }
    hostnames.push(hostOnly);
  }

  // Parse dbName from path
  let dbName = '';
  if (pathAndQuery.startsWith('/')) {
    const afterSlash = pathAndQuery.slice(1);
    const qIdx = afterSlash.indexOf('?');
    dbName = (qIdx === -1 ? afterSlash : afterSlash.slice(0, qIdx)).trim();
  }

  // Create redacted URI (password and username replaced with ***:***)
  const userInfoRedacted = hasAuth ? '***:***@' : '';
  const redactedUri = `${protocol}://${userInfoRedacted}${hostString}/${dbName}`;

  return {
    valid: true,
    protocol,
    hasAuth,
    hosts,
    hostnames,
    hostString,
    dbName,
    redactedUri,
  };
}

/**
 * Returns a safely redacted version of a MongoDB URI with credentials stripped.
 * Never throws.
 * 
 * @param {string} uri - Raw MongoDB connection string
 * @returns {string} Redacted URI or fallback placeholder
 */
export function redactMongoUri(uri) {
  try {
    const parsed = parseMongoUri(uri);
    return parsed.valid ? parsed.redactedUri : '[invalid-mongodb-uri]';
  } catch {
    return '[invalid-mongodb-uri]';
  }
}

/**
 * Validates a MongoDB URI against explicit staging configuration in a fail-closed manner.
 * 
 * @param {string} [mongoUri] - The MongoDB connection string (defaults to process.env.MONGODB_URI)
 * @param {object} [config] - Validation configuration overrides
 * @param {string} [config.expectedDbName] - Expected exact database name (or process.env.MIGRATION_EXPECTED_DB_NAME)
 * @param {string|string[]} [config.allowedHosts] - Approved host allowlist (or process.env.MIGRATION_ALLOWED_HOSTS)
 * @param {boolean} [config.allowProduction=false] - Whether production target bypass is allowed
 * @param {boolean} [config.isProductionConfirm=false] - Explicit production confirmation flag
 * @returns {object} Validation result: { valid: boolean, code: string, error?: string, target?: object }
 */
export function validateMigrationTarget(mongoUri = process.env.MONGODB_URI, config = {}) {
  // Gate 1: Check URI presence
  if (!mongoUri || typeof mongoUri !== 'string' || mongoUri.trim().length === 0) {
    return {
      valid: false,
      code: 'MISSING_MONGODB_URI',
      error: 'Target MongoDB URI is missing or empty. Please set MONGODB_URI.',
    };
  }

  // Gate 2: Parse URI safely
  const parsed = parseMongoUri(mongoUri);
  if (!parsed.valid) {
    return {
      valid: false,
      code: 'MALFORMED_MONGODB_URI',
      error: `Malformed MongoDB URI: ${parsed.error}`,
    };
  }

  // Gate 3: Check database name in URI
  if (!parsed.dbName || parsed.dbName.trim().length === 0) {
    return {
      valid: false,
      code: 'MISSING_TARGET_DB_NAME',
      error: 'Target MongoDB URI does not specify a database name path (e.g. mongodb://host:port/database_name).',
    };
  }

  const actualDbName = parsed.dbName.trim();

  // Gate 4: Resolve and enforce expected database name configuration
  const expectedDbName = (
    config.expectedDbName !== undefined
      ? config.expectedDbName
      : process.env.MIGRATION_EXPECTED_DB_NAME
  );

  if (!expectedDbName || typeof expectedDbName !== 'string' || expectedDbName.trim().length === 0) {
    return {
      valid: false,
      code: 'MISSING_EXPECTED_DB_CONFIG',
      error: 'MIGRATION_EXPECTED_DB_NAME is not configured. Target validation requires explicit expected database configuration.',
    };
  }

  const cleanExpectedDb = expectedDbName.trim();

  // Gate 5: Resolve and enforce approved host allowlist configuration
  const rawAllowedHosts = (
    config.allowedHosts !== undefined
      ? config.allowedHosts
      : process.env.MIGRATION_ALLOWED_HOSTS
  );

  let allowedHostsList = [];
  if (Array.isArray(rawAllowedHosts)) {
    allowedHostsList = rawAllowedHosts
      .map((h) => (typeof h === 'string' ? h.trim() : ''))
      .filter(Boolean);
  } else if (typeof rawAllowedHosts === 'string') {
    allowedHostsList = rawAllowedHosts
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
  }

  if (allowedHostsList.length === 0) {
    return {
      valid: false,
      code: 'MISSING_ALLOWED_HOSTS_CONFIG',
      error: 'MIGRATION_ALLOWED_HOSTS is not configured. Target validation requires an explicit approved host allowlist.',
    };
  }

  const allowedHostsSet = new Set(allowedHostsList.map((h) => h.toLowerCase()));

  // Gate 6: Exact Database Name Match (fail-closed, no substring matching)
  if (actualDbName !== cleanExpectedDb) {
    return {
      valid: false,
      code: 'DB_NAME_MISMATCH',
      error: `Target database name "${actualDbName}" does not match configured expected database "${cleanExpectedDb}". Target rejected.`,
    };
  }

  // Gate 7: Host Allowlist Validation (every host in the URI must be in the allowlist)
  for (let i = 0; i < parsed.hosts.length; i++) {
    const hostWithPort = parsed.hosts[i].toLowerCase();
    const hostNameOnly = parsed.hostnames[i].toLowerCase();

    const isAllowed = allowedHostsSet.has(hostWithPort) || allowedHostsSet.has(hostNameOnly);
    if (!isAllowed) {
      return {
        valid: false,
        code: 'HOST_NOT_ALLOWED',
        error: `Host "${parsed.hosts[i]}" in target MongoDB URI is not in the approved MIGRATION_ALLOWED_HOSTS allowlist [${allowedHostsList.join(', ')}]. Target rejected.`,
      };
    }
  }

  // Gate 8: Production Target Safety Refusal
  const allowProduction = Boolean(config.allowProduction);
  const isProductionConfirm = Boolean(config.isProductionConfirm);

  const isProdDbName = FORBIDDEN_PROD_DB_NAMES.has(actualDbName.toLowerCase());
  const hasProdHostname = parsed.hostnames.some((h) => {
    const lower = h.toLowerCase();
    return (lower.includes('prod') || lower.includes('production')) && !lower.includes('staging');
  });

  if (isProdDbName || hasProdHostname) {
    if (!allowProduction || !isProductionConfirm) {
      return {
        valid: false,
        code: 'PRODUCTION_TARGET_REJECTED',
        error: `Target database or host (${actualDbName} @ ${parsed.hostString}) is classified as production. Migration runner strictly rejects production targets unless explicitly permitted and confirmed.`,
      };
    }
  }

  // Target successfully validated
  return {
    valid: true,
    code: 'TARGET_VALIDATED',
    target: {
      protocol: parsed.protocol,
      hosts: parsed.hosts,
      hostnames: parsed.hostnames,
      dbName: actualDbName,
      redactedUri: parsed.redactedUri,
    },
  };
}

export default validateMigrationTarget;
