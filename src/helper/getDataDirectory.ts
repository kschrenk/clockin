import path from 'path';
import os from 'os';

const DIR_NAME = 'clockin-data';

export function getDataDirectory(configPath: string | undefined): string {
  return configPath ? path.join(configPath, DIR_NAME) : path.join(os.homedir(), DIR_NAME);
}
