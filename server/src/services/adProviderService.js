import crypto from 'node:crypto';
import https from 'node:https';

let publicKeysCache = null;
let keysFetchedAt = 0;
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Hard cap of 24 hours

// Test key registry for deterministic offline unit and integration testing
const testKeyRegistry = new Map();

/**
 * Fetch Google AdMob public keys with 24-hour in-memory caching.
 */
async function fetchGooglePublicKeys() {
  const now = Date.now();
  if (publicKeysCache && now - keysFetchedAt < KEY_CACHE_TTL_MS) {
    return publicKeysCache;
  }

  return new Promise((resolve) => {
    https
      .get('https://admob.googleapis.com/v1/publicKeys', (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            if (parsed && Array.isArray(parsed.keys)) {
              publicKeysCache = parsed.keys;
              keysFetchedAt = Date.now();
              resolve(publicKeysCache);
            } else {
              resolve(publicKeysCache || []);
            }
          } catch (_e) {
            resolve(publicKeysCache || []);
          }
        });
      })
      .on('error', () => {
        resolve(publicKeysCache || []);
      });
  });
}

/**
 * Converts a raw base64 AdMob SubjectPublicKeyInfo key into PEM format.
 */
function base64ToPem(base64Key) {
  const clean = base64Key.replace(/[\r\n\s]/g, '');
  const lines = clean.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

export const adProviderService = {
  /**
   * Register a temporary test key pair for integration tests.
   */
  registerTestKey(keyId, pemPublicKey) {
    testKeyRegistry.set(String(keyId), pemPublicKey);
  },

  /**
   * Clear all registered test keys.
   */
  clearTestKeys() {
    testKeyRegistry.clear();
  },

  /**
   * Verify Google AdMob SSV callback.
   * Signature is checked against the raw query string bytes preceding &signature=.
   */
  async verifyAdMobSSV({ rawQueryString, queryParams }) {
    const { key_id, signature } = queryParams;

    if (!key_id || !signature) {
      return {
        valid: false,
        error: 'Missing required AdMob SSV parameters (key_id or signature).',
      };
    }

    if (!rawQueryString) {
      return {
        valid: false,
        error: 'Raw query string required for strict byte verification.',
      };
    }

    // Extract exact message bytes preceding &signature=
    const sigIndex = rawQueryString.indexOf('&signature=');
    const messageToVerify = sigIndex !== -1 ? rawQueryString.substring(0, sigIndex) : rawQueryString;

    // Check test registry first
    let pemKey = testKeyRegistry.get(String(key_id));

    if (!pemKey) {
      const keys = await fetchGooglePublicKeys();
      const matchedKey = keys.find((k) => String(k.keyId) === String(key_id));
      if (!matchedKey || !matchedKey.base64) {
        return {
          valid: false,
          error: `AdMob public key not found for key_id: ${key_id}`,
        };
      }
      pemKey = base64ToPem(matchedKey.base64);
    }

    try {
      // AdMob signatures are web-safe base64 encoded ASN.1 DER ECDSA signatures
      const normalizedSig = signature.replace(/-/g, '+').replace(/_/g, '/');
      const sigBuffer = Buffer.from(normalizedSig, 'base64');

      const verifier = crypto.createVerify('SHA256');
      verifier.update(Buffer.from(messageToVerify, 'utf8'));
      const isVerified = verifier.verify(pemKey, sigBuffer);

      return {
        valid: isVerified,
        error: isVerified ? null : 'Cryptographic signature verification failed.',
      };
    } catch (err) {
      return {
        valid: false,
        error: `SSV verification error: ${err.message}`,
      };
    }
  },

  /**
   * Verify mock provider callbacks in non-production environments. Fails closed in production.
   */
  verifyMockSSV(headers, body) {
    if (process.env.NODE_ENV === 'production') {
      return {
        valid: false,
        error: 'Mock provider disabled in production.',
      };
    }

    const mockSecret = process.env.MOCK_PROVIDER_SECRET || 'test_mock_ssv_secret_dev';
    const clientSecret = headers['x-mock-provider-secret'];

    if (!clientSecret || clientSecret !== mockSecret) {
      return {
        valid: false,
        error: 'Invalid or missing X-Mock-Provider-Secret header.',
      };
    }

    if (!body || !body.custom_data) {
      return {
        valid: false,
        error: 'Missing custom_data in mock payload.',
      };
    }

    return { valid: true };
  },
};

export default adProviderService;