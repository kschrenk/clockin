import fs from 'fs/promises';
import path from 'path';
import { dayjs } from './date-utils.js';
import { Config, WorkSession } from './types.js';

export function getSessionPath(config: Config): string {
  return path.join(config.dataDirectory, 'current-session.json');
}

export async function readCurrentSession(config: Config): Promise<WorkSession | null> {
  try {
    const data = await fs.readFile(getSessionPath(config), 'utf-8');
    const session = JSON.parse(data);
    return {
      ...session,
      startTime: dayjs(session.startTime).toISOString(),
      pauseStartTime: session.pauseStartTime
        ? dayjs(session.pauseStartTime).toISOString()
        : undefined,
    };
  } catch {
    return null;
  }
}

export async function writeCurrentSession(config: Config, session: WorkSession): Promise<void> {
  const sessionPath = getSessionPath(config);
  const sessionDir = path.dirname(sessionPath);
  try {
    await fs.access(sessionDir);
  } catch {
    await fs.mkdir(sessionDir, { recursive: true });
  }
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
}

export async function clearStoredSession(config: Config): Promise<void> {
  try {
    await fs.unlink(getSessionPath(config));
  } catch {
    // ignore
  }
}
