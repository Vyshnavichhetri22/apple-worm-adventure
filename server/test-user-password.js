import dns from 'node:dns';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import User from './src/models/User.js';
import { assertValidTestTarget } from './src/utils/validateTestTarget.js';

// Apply DNS workaround before any connection attempt to resolve Atlas SRV records
dns.setServers(['8.8.8.8', '1.1.1.1']);

// Setup __dirname for ES modules and load server/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function runPasswordTests(deps = {}) {
  let testUserId = null;
  let testsPassed = 0;
  let testsFailed = 0;

  const validateTarget = deps.validateTarget || assertValidTestTarget;
  const connectFn = deps.connect || ((uri) => mongoose.connect(uri));
  const testMongoUri = deps.mongoUri || process.env.TEST_MONGODB_URI || process.env.MONGODB_TEST_URI;

  // Gate: Enforce database target validation BEFORE attempting connection
  validateTarget(testMongoUri);

  if (deps.validateOnly) {
    return { validated: true, targetUri: testMongoUri };
  }

  function report(testName, passed, details = '') {
    if (passed) {
      console.log(`[PASS] ${testName}`);
      testsPassed++;
    } else {
      console.error(`[FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
      testsFailed++;
    }
  }

  try {
    console.log('Connecting to MongoDB test database...');
    await connectFn(testMongoUri);
    console.log('Connected to MongoDB.\n--- Starting Password Tests ---');

    // Generate unique temporary test user credentials
    const timestamp = Date.now();
    const testUsername = `test_runner_${timestamp}`;
    const testEmail = `test_runner_${timestamp}@example.com`;
    const plainPassword = 'DummyTestPassword123!';
    const wrongPassword = 'WrongDummyPassword999!';

    // Create temporary test user
    const user = await User.create({
      username: testUsername,
      email: testEmail,
      password: plainPassword,
    });
    testUserId = user._id;

    // Test 1: Verify password is saved as a bcrypt hash, not plain text
    const isHashed = user.password !== plainPassword && user.password.startsWith('$2');
    report('1. Password hashed before saving', isHashed, `Stored: ${user.password.substring(0, 10)}...`);

    // Test 2: Verify comparePassword returns true for the correct password
    const isMatchCorrect = await user.comparePassword(plainPassword);
    report('2. comparePassword returns true for correct password', isMatchCorrect === true);

    // Test 3: Verify comparePassword returns false for an incorrect password
    const isMatchWrong = await user.comparePassword(wrongPassword);
    report('3. comparePassword returns false for incorrect password', isMatchWrong === false);

    // Test 4: Verify password hash is omitted during JSON serialization
    const userJson = user.toJSON();
    const rawJsonString = JSON.stringify(user);
    const isPasswordHidden = !('password' in userJson) && !rawJsonString.includes(user.password);
    report('4. Password excluded from serialized JSON response', isPasswordHidden);

    // Test 5: Verify updating non-password fields does not trigger re-hashing
    const originalHash = user.password;
    user.coins += 100;
    user.totalScore += 500;
    await user.save();
    const isHashPreserved = user.password === originalHash;
    report('5. Modifying non-password fields preserves existing password hash', isHashPreserved);

  } catch (error) {
    console.error('\nTest Suite encountered an error:', error.message);
    testsFailed++;
  } finally {
    // Clean up: Always delete temporary test user even if an assertion threw an error
    if (testUserId) {
      try {
        await User.findByIdAndDelete(testUserId);
        console.log('\n[CLEANUP] Temporary test user removed from database.');
      } catch (cleanupError) {
        console.error('\n[CLEANUP ERROR] Failed to remove test user:', cleanupError.message);
      }
    }

    // Disconnect cleanly from MongoDB
    await mongoose.disconnect();
    console.log('[CLEANUP] MongoDB connection closed.');

    // Summary
    console.log('---------------------------------');
    console.log(`Results: ${testsPassed} passed, ${testsFailed} failed.`);
    console.log('---------------------------------');

    if (testsFailed > 0) {
      process.exitCode = 1;
    }
  }
}

export { runPasswordTests };

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('test-user-password.js') || process.argv[1].endsWith('test-user-password'));

if (isMain) {
  runPasswordTests().catch((err) => {
    console.error('\n💥 Critical Database Safety Abort:', err.message);
    process.exit(1);
  });
}