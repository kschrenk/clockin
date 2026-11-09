// vitest.setup.js
import dotenv from 'dotenv';
const { parsed } = dotenv.config({ path: '.env.test', quiet: true });

// Test files run in parallel workers and several of them rm -rf the config dir, so give each
// worker its own. Derived from the .env.test value (not process.env) so it doesn't compound
// when the setup file runs again for the next test file in the same worker.
if (parsed?.CLOCKIN_CONFIG_PATH) {
  process.env.CLOCKIN_CONFIG_PATH = `${parsed.CLOCKIN_CONFIG_PATH}-${process.env.VITEST_POOL_ID ?? process.pid}`;
}
