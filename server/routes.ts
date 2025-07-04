import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { storage } from "./storage";
import { azurePipelineService } from "./azure-pipeline";
import { scheduler } from "./scheduler";

function isDaylightSavingTime(): boolean {
  const now = new Date();
  const january = new Date(now.getFullYear(), 0, 1);
  const july = new Date(now.getFullYear(), 6, 1);
  const stdOffset = Math.max(january.getTimezoneOffset(), july.getTimezoneOffset());
  return now.getTimezoneOffset() < stdOffset;
}

function calculateNextRun(time: string, timezone: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const now = new Date();
  const nextRun = new Date();
  
  // Convert Eastern to UTC (add 4 hours for EDT, 5 for EST)
  const isDST = isDaylightSavingTime();
  const utcHours = hours + (isDST ? 4 : 5);
  
  nextRun.setUTCHours(utcHours, minutes, 0, 0);
  
  // If already past the scheduled time today, schedule for tomorrow
  if (nextRun <= now) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }
  
  return nextRun.toISOString();
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // WebSocket server for real-time updates on a specific path
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/api/ws'
  });

  wss.on('connection', (ws) => {
    console.log('Pipeline WebSocket client connected');
    azurePipelineService.setWebSocket(ws);

    ws.on('close', () => {
      console.log('Pipeline WebSocket client disconnected');
    });
  });

  // API Routes
  app.post('/api/pipeline/start', async (req, res) => {
    try {
      const { batchSize = 100 } = req.body;
      
      // Start pipeline execution asynchronously with batch size
      azurePipelineService.executePipeline(batchSize).catch(error => {
        console.error('Pipeline execution failed:', error);
      });

      res.json({ message: 'Pipeline started successfully', batchSize });
    } catch (error: any) {
      console.error('Failed to start pipeline:', error);
      res.status(500).json({ message: 'Failed to start pipeline', error: error.message });
    }
  });

  app.get('/api/pipeline/status', async (req, res) => {
    try {
      const latestExecution = await storage.getLatestPipelineExecution();
      res.json(latestExecution || null);
    } catch (error: any) {
      console.error('Failed to get pipeline status:', error);
      res.status(500).json({ message: 'Failed to get pipeline status', error: error.message });
    }
  });

  app.get('/api/activity-logs', async (req, res) => {
    try {
      const logs = await storage.getRecentActivityLogs(20);
      res.json(logs);
    } catch (error: any) {
      console.error('Failed to get activity logs:', error);
      res.status(500).json({ message: 'Failed to get activity logs', error: error.message });
    }
  });

  app.delete('/api/activity-logs', async (req, res) => {
    try {
      await storage.clearActivityLogs();
      res.json({ message: 'Activity logs cleared successfully' });
    } catch (error: any) {
      console.error('Failed to clear activity logs:', error);
      res.status(500).json({ message: 'Failed to clear activity logs', error: error.message });
    }
  });

  app.get('/api/pipeline/processed-jobs', async (req, res) => {
    try {
      const processedJobs = azurePipelineService.getProcessedJobs();
      res.json(processedJobs);
    } catch (error: any) {
      console.error('Failed to get processed jobs:', error);
      res.status(500).json({ message: 'Failed to get processed jobs', error: error.message });
    }
  });

  app.get('/api/jobs', async (req, res) => {
    try {
      console.log('🔍 Testing database connection and retrieving jobs...');
      const jobs = await storage.getAllJobPostings();
      console.log('📊 Retrieved jobs count:', jobs.length);
      console.log('Sample job:', jobs[0] ? JSON.stringify(jobs[0], null, 2) : 'No jobs found');
      res.json(jobs);
    } catch (error: any) {
      console.error('❌ Failed to get jobs:', error);
      res.status(500).json({ message: 'Failed to get jobs', error: error.message });
    }
  });

  app.get('/api/job-postings', async (req, res) => {
    try {
      const jobPostings = await storage.getAllJobPostings();
      res.json(jobPostings);
    } catch (error: any) {
      console.error('Failed to get job postings:', error);
      res.status(500).json({ message: 'Failed to get job postings', error: error.message });
    }
  });

  app.delete('/api/jobs/clear', async (req, res) => {
    try {
      console.log('🧹 Clearing all job postings...');
      const jobs = await storage.getAllJobPostings();
      for (const job of jobs) {
        await storage.deleteJobPosting(job.jobId);
      }
      console.log('✅ Cleared all job postings');
      res.json({ message: 'All job postings cleared successfully' });
    } catch (error: any) {
      console.error('❌ Failed to clear jobs:', error);
      res.status(500).json({ message: 'Failed to clear jobs', error: error.message });
    }
  });

  app.post('/api/database/initialize', async (req, res) => {
    try {
      console.log('Creating database tables...');
      
      // Get database connection
      const { AzureSQLStorage } = await import('./azure-sql-storage');
      const sqlStorage = new AzureSQLStorage();
      const pool = await (sqlStorage as any).getPool();
      
      // Create tables
      const createJobPostingsTable = `
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='job_postings' and xtype='U')
        CREATE TABLE job_postings (
          id INT IDENTITY(1,1) PRIMARY KEY,
          jobID NVARCHAR(50) UNIQUE,
          title NVARCHAR(500),
          description NVARCHAR(MAX),
          full_text NVARCHAR(MAX),
          url NVARCHAR(500),
          company_name NVARCHAR(200),
          brand NVARCHAR(200),
          functional_area NVARCHAR(200),
          work_type NVARCHAR(100),
          location_city NVARCHAR(200),
          location_state NVARCHAR(200),
          state_abbrev NVARCHAR(10),
          zip_code NVARCHAR(20),
          country NVARCHAR(100),
          latitude NVARCHAR(50),
          longitude NVARCHAR(50),
          location_point NVARCHAR(100),
          job_details_json NVARCHAR(MAX),
          status NVARCHAR(50),
          is_expired BIT,
          record_created_on DATETIME2 DEFAULT GETDATE(),
          created_at DATETIME2 DEFAULT GETDATE(),
          last_seen DATETIME2 DEFAULT GETDATE(),
          lastDayToApply DATETIME2,
          businessArea NVARCHAR(200)
        )
      `;
      
      const createPipelineExecutionsTable = `
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='pipeline_executions' and xtype='U')
        CREATE TABLE pipeline_executions (
          id INT IDENTITY(1,1) PRIMARY KEY,
          status NVARCHAR(50),
          startTime DATETIME2 DEFAULT GETDATE(),
          endTime DATETIME2,
          totalJobs INT DEFAULT 0,
          processedJobs INT DEFAULT 0,
          newJobs INT DEFAULT 0,
          removedJobs INT DEFAULT 0,
          currentStep NVARCHAR(500),
          errorMessage NVARCHAR(MAX)
        )
      `;
      
      const createActivityLogsTable = `
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='activity_logs' and xtype='U')
        CREATE TABLE activity_logs (
          id INT IDENTITY(1,1) PRIMARY KEY,
          message NVARCHAR(1000),
          level NVARCHAR(50),
          timestamp DATETIME2 DEFAULT GETDATE(),
          executionId INT
        )
      `;
      
      await pool.request().query(createJobPostingsTable);
      console.log('✅ Created job_postings table');
      
      await pool.request().query(createPipelineExecutionsTable);
      console.log('✅ Created pipeline_executions table');
      
      await pool.request().query(createActivityLogsTable);
      console.log('✅ Created activity_logs table');
      
      res.json({ message: 'Database tables created successfully' });
    } catch (error: any) {
      console.error('Failed to create database tables:', error);
      res.status(500).json({ message: 'Failed to create database tables', error: error.message });
    }
  });

  // Scheduling endpoints
  app.post('/api/schedule/activate', async (req, res) => {
    try {
      const { enabled = true, time = "02:00", date, timezone = "America/New_York", oneTime = false } = req.body;
      
      let nextRun;
      if (oneTime && date) {
        // For one-time execution, use the specific date and time
        const [hours, minutes] = time.split(':').map(Number);
        const scheduledDate = new Date(date);
        scheduledDate.setHours(hours, minutes, 0, 0);
        nextRun = scheduledDate.toISOString();
      } else {
        // For recurring execution, calculate next daily run
        nextRun = calculateNextRun(time, timezone);
      }
      
      const scheduleConfig = {
        enabled,
        time,
        timezone,
        nextRun,
        activated: new Date().toISOString(),
        oneTime: oneTime || false,
        date: date || null
      };
      
      // Save configuration through scheduler service
      await scheduler.saveScheduleConfig(scheduleConfig);
      
      await storage.createActivityLog({
        message: oneTime 
          ? `One-time schedule activated for ${new Date(nextRun).toLocaleString()}`
          : `Daily schedule ${enabled ? 'activated' : 'deactivated'} for ${time} ${timezone}`,
        level: 'success'
      });
      
      res.json({ 
        success: true, 
        message: oneTime ? 'One-time schedule activated successfully' : `Schedule ${enabled ? 'activated' : 'deactivated'} successfully`,
        config: scheduleConfig
      });
    } catch (error) {
      console.error('Schedule activation error:', error);
      res.status(500).json({ error: 'Failed to update schedule configuration' });
    }
  });

  app.get('/api/schedule/status', async (req, res) => {
    try {
      const config = scheduler.getScheduleConfig();
      
      if (!config) {
        res.json({
          enabled: false,
          time: "02:00",
          timezone: "America/New_York",
          nextRun: calculateNextRun("02:00", "America/New_York"),
          status: "inactive"
        });
      } else {
        res.json({
          ...config,
          status: config.enabled ? "active" : "inactive"
        });
      }
    } catch (error) {
      console.error('Schedule status error:', error);
      res.status(500).json({ error: 'Failed to get schedule status' });
    }
  });

  app.post('/api/schedule/test', async (req, res) => {
    try {
      await storage.createActivityLog({
        message: 'Test schedule execution started',
        level: 'info'
      });

      // Start the pipeline in the background with 1000 batch size
      azurePipelineService.executePipeline(1000).catch(error => {
        console.error('Test execution error:', error);
      });

      res.json({ 
        success: true, 
        message: 'Test execution started'
      });
    } catch (error) {
      console.error('Test execution error:', error);
      res.status(500).json({ error: 'Failed to start test execution' });
    }
  });

  // Webhook endpoint for external pipeline triggering
  app.post('/api/webhook/trigger-pipeline', async (req, res) => {
    try {
      console.log('🔗 Webhook received: Triggering pipeline execution with 1000 batch size');
      
      await storage.createActivityLog({
        message: 'Pipeline triggered via webhook endpoint',
        level: 'info'
      });

      // Start pipeline execution asynchronously with 1000 batch size
      azurePipelineService.executePipeline(1000).catch(error => {
        console.error('Webhook pipeline execution failed:', error);
      });

      res.json({ 
        success: true,
        message: 'Pipeline execution started via webhook',
        batchSize: 1000,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Webhook pipeline trigger failed:', error);
      res.status(500).json({ 
        success: false,
        message: 'Failed to trigger pipeline via webhook', 
        error: error.message 
      });
    }
  });

  app.get('/api/system-status', async (req, res) => {
    try {
      // Check if environment variables are set
      const status = {
        algoliaApi: true, // Always true for now
        azureOpenAI: !!(process.env.AZURE_OPENAI_KEY || process.env.Azure_OpenAI_Key),
        googleGeocoding: !!process.env.GOOGLE_GEOCODING_API_KEY,
        azureSQL: true, // Always true for in-memory storage
        connectionStatus: 'connected'
      };

      res.json(status);
    } catch (error: any) {
      console.error('Failed to get system status:', error);
      res.status(500).json({ message: 'Failed to get system status', error: error.message });
    }
  });

  return httpServer;
}
