import dotenv from 'dotenv';

export function loadConfig() {
  if (!process.env.VITEST) {
    const isDevelopment = process.argv[0].includes('tsx') || process.env.NODE_ENV === 'development';

    if (isDevelopment) {
      dotenv.config({ path: '.env.local' });
    } else {
      dotenv.config({ path: '.env', quiet: true });
    }
  }
}
