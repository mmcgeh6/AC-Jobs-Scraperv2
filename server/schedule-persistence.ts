import { promises as fs } from 'fs';
import path from 'path';

const SCHEDULE_FILE = path.join(process.cwd(), 'schedule-config.json');

export interface ScheduleConfig {
  enabled: boolean;
  time: string;
  timezone: string;
  nextRun: string;
  activated: string;
}

export async function saveScheduleConfig(config: ScheduleConfig): Promise<void> {
  try {
    await fs.writeFile(SCHEDULE_FILE, JSON.stringify(config, null, 2));
    console.log('💾 Schedule configuration saved to file:', config);
  } catch (error) {
    console.error('❌ Failed to save schedule config to file:', error);
  }
}

export async function loadScheduleConfig(): Promise<ScheduleConfig | null> {
  try {
    const data = await fs.readFile(SCHEDULE_FILE, 'utf8');
    const config = JSON.parse(data);
    console.log('📋 Loaded schedule configuration from file:', config);
    return config;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('❌ Failed to load schedule config from file:', error);
    }
    return null;
  }
}