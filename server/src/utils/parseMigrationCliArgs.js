/**
 * server/src/utils/parseMigrationCliArgs.js
 * 
 * Strict, fail-closed CLI argument parser for migration and maintenance scripts:
 *   - scripts/migrate-wallet-idempotency-index.js
 *   - scripts/migrate-wallet-opid-index.js
 *   - scripts/initialize-wallet-baseline.js
 * 
 * Supported arguments:
 *   --apply                 Enable live mutation mode (default is dry-run)
 *   --confirm-production    Explicit confirmation required when executing in production
 *   --env-file=<path>       Specify custom environment file to load
 *   --env=<path>            Alias for --env-file=<path>
 * 
 * Strict safety rules:
 *   - '=' syntax is strictly required for --env-file and --env.
 *   - Space-separated syntax (e.g. '--env-file .env.staging') is rejected.
 *   - Empty file paths (e.g. '--env-file=') are rejected.
 *   - Duplicate environment flags (e.g. '--env-file=a --env-file=b') are rejected.
 *   - Conflicting environment flags (e.g. '--env-file=a --env=b') are rejected.
 *   - Unknown CLI arguments are rejected.
 *   - Fails closed before any database connection attempt.
 */

export const CLI_ARG_ERROR_CODES = {
  UNSUPPORTED_ENV_FILE_SYNTAX: 'UNSUPPORTED_ENV_FILE_SYNTAX',
  EMPTY_ENV_FILE_PATH: 'EMPTY_ENV_FILE_PATH',
  DUPLICATE_ENV_FILE_ARG: 'DUPLICATE_ENV_FILE_ARG',
  UNKNOWN_ARGUMENT: 'UNKNOWN_ARGUMENT',
};

export function parseMigrationCliArgs(rawArgs = process.argv.slice(2)) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];

  let isApply = false;
  let isProductionConfirm = false;
  let envFilePath = null;
  let hasEnvArg = false;

  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]).trim();

    // Check for space-separated syntax or bare env flags: e.g. '--env-file' or '--env'
    if (arg === '--env-file' || arg === '--env') {
      return {
        valid: false,
        code: CLI_ARG_ERROR_CODES.UNSUPPORTED_ENV_FILE_SYNTAX,
        error: `Unsupported syntax for "${arg}": space-separated arguments are not permitted. Use --env-file=<path> or --env=<path>.`,
        invalidArg: arg,
      };
    }

    // Check for malformed env flags (e.g. '--env-file:path' or '--env.staging')
    if (
      (arg.startsWith('--env-file') && !arg.startsWith('--env-file=')) ||
      (arg.startsWith('--env:') || arg.startsWith('--env.'))
    ) {
      return {
        valid: false,
        code: CLI_ARG_ERROR_CODES.UNSUPPORTED_ENV_FILE_SYNTAX,
        error: `Unsupported syntax for "${arg}": use --env-file=<path> or --env=<path>.`,
        invalidArg: arg,
      };
    }

    // Check for --env-file=<path> or --env=<path>
    if (arg.startsWith('--env-file=') || arg.startsWith('--env=')) {
      if (hasEnvArg) {
        return {
          valid: false,
          code: CLI_ARG_ERROR_CODES.DUPLICATE_ENV_FILE_ARG,
          error: `Multiple environment file flags provided. Conflicting or duplicate flags are not permitted: received "${arg}".`,
          invalidArg: arg,
        };
      }

      const eqIndex = arg.indexOf('=');
      const rawVal = arg.slice(eqIndex + 1).trim();

      if (!rawVal) {
        return {
          valid: false,
          code: CLI_ARG_ERROR_CODES.EMPTY_ENV_FILE_PATH,
          error: `Environment file path cannot be empty for argument "${arg.slice(0, eqIndex)}="`,
          invalidArg: arg,
        };
      }

      envFilePath = rawVal;
      hasEnvArg = true;
      continue;
    }

    // Check for --apply
    if (arg === '--apply') {
      isApply = true;
      continue;
    }

    // Check for --confirm-production
    if (arg === '--confirm-production') {
      isProductionConfirm = true;
      continue;
    }

    // Any other argument is completely unknown and rejected
    return {
      valid: false,
      code: CLI_ARG_ERROR_CODES.UNKNOWN_ARGUMENT,
      error: `Unknown argument "${arg}". Supported arguments are: --apply, --confirm-production, --env-file=<path>, --env=<path>.`,
      invalidArg: arg,
    };
  }

  return {
    valid: true,
    isApply,
    isProductionConfirm,
    envFilePath,
  };
}
