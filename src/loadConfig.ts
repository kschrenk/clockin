import dotenv from 'dotenv';
import os from 'os';
import path from 'path';

export function loadConfig() {
  if (!process.env.VITEST) {
    const isDevelopment = process.argv[0].includes('tsx') || process.env.NODE_ENV === 'development';

    if (isDevelopment) {
      dotenv.config({ path: '.env.local' });
    } else {
      dotenv.config({ path: path.join(os.homedir(), '.clockin/.env'), quiet: false });
    }
  }
}
