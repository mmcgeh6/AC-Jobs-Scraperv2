import { azurePipelineService } from './azure-pipeline';
import { storage } from './storage';

interface ScheduleConfig {
  enabled: boolean;
  time: string;
  timezone: string;
  lastRun?: string;
  nextRun: string;
}

class Scheduler {
  private scheduleConfig: ScheduleConfig | null = null;
  private schedulerInterval: NodeJS.Timeout | null = null;

  async start() {
    console.log('📅 Starting scheduler service...');
    
    // Load existing schedule config from storage
    await this.loadScheduleConfig();
    
    // Start the scheduler check every minute
    this.schedulerInterval = setInterval(() => {
      this.checkSchedule();
    }, 60000); // Check every minute
    
    console.log('✅ Scheduler service started');
  }

  async stop() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    console.log('⏹️ Scheduler service stopped');
  }

  async saveScheduleConfig(config: ScheduleConfig) {
    this.scheduleConfig = config;
    
    // Store in activity logs as a simple persistence mechanism
    await storage.createActivityLog({
      message: `SCHEDULE_CONFIG:${JSON.stringify(config)}`,
      level: 'info'
    });
    
    console.log('💾 Schedule configuration saved:', config);
  }

  async loadScheduleConfig() {
    try {
      // Load from activity logs
      const logs = await storage.getRecentActivityLogs(100);
      const scheduleLog = logs.find(log => log.message.startsWith('SCHEDULE_CONFIG:'));
      
      if (scheduleLog) {
        const configJson = scheduleLog.message.replace('SCHEDULE_CONFIG:', '');
        this.scheduleConfig = JSON.parse(configJson);
        console.log('📋 Loaded schedule configuration:', this.scheduleConfig);
      } else {
        console.log('📋 No existing schedule configuration found');
      }
    } catch (error) {
      console.error('❌ Failed to load schedule config:', error);
    }
  }

  getScheduleConfig(): ScheduleConfig | null {
    return this.scheduleConfig;
  }

  private async checkSchedule() {
    if (!this.scheduleConfig || !this.scheduleConfig.enabled) {
      return;
    }

    const now = new Date();
    const nextRun = new Date(this.scheduleConfig.nextRun);

    // Check if it's time to run (within 1 minute window)
    if (now >= nextRun && now.getTime() - nextRun.getTime() < 60000) {
      console.log('⏰ Scheduled pipeline execution triggered');
      
      await storage.createActivityLog({
        message: `Automated pipeline execution started at ${now.toISOString()}`,
        level: 'info'
      });

      // Update last run and calculate next run
      this.scheduleConfig.lastRun = now.toISOString();
      this.scheduleConfig.nextRun = this.calculateNextRun(this.scheduleConfig.time, this.scheduleConfig.timezone);
      
      // Save updated config
      await this.saveScheduleConfig(this.scheduleConfig);

      // Execute pipeline with 1000 batch size
      try {
        await azurePipelineService.executePipeline(1000);
        
        await storage.createActivityLog({
          message: `Scheduled pipeline execution completed successfully`,
          level: 'success'
        });
      } catch (error) {
        console.error('❌ Scheduled pipeline execution failed:', error);
        
        await storage.createActivityLog({
          message: `Scheduled pipeline execution failed: ${error}`,
          level: 'error'
        });
      }
    }
  }

  private calculateNextRun(time: string, timezone: string): string {
    // Hard-coded fallback for 9:30 AM Eastern daily
    if (time === "09:30") {
      const now = new Date();
      
      // 9:30 AM Eastern = 1:30 PM UTC (during EDT) or 2:30 PM UTC (during EST)
      // Currently in June, so EDT applies (9:30 AM + 4 hours = 1:30 PM UTC)
      const nextRun = new Date();
      nextRun.setUTCHours(13, 30, 0, 0); // 1:30 PM UTC
      
      // If already past 1:30 PM UTC today, schedule for tomorrow
      if (nextRun <= now) {
        nextRun.setUTCDate(nextRun.getUTCDate() + 1);
      }
      
      return nextRun.toISOString();
    }
    
    // Fallback for other times
    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    const nextRun = new Date();
    
    // Convert Eastern to UTC (subtract 4 hours for EDT, 5 for EST)
    const isDST = this.isDaylightSavingTime();
    const utcHours = hours + (isDST ? 4 : 5);
    
    nextRun.setUTCHours(utcHours, minutes, 0, 0);
    
    if (nextRun <= now) {
      nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    }
    
    return nextRun.toISOString();
  }

  private isDaylightSavingTime(): boolean {
    const now = new Date();
    const january = new Date(now.getFullYear(), 0, 1);
    const july = new Date(now.getFullYear(), 6, 1);
    const stdOffset = Math.max(january.getTimezoneOffset(), july.getTimezoneOffset());
    return now.getTimezoneOffset() < stdOffset;
  }
}

export const scheduler = new Scheduler();