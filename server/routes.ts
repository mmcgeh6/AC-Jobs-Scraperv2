import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { storage } from "./storage";
import { pipelineService } from "./pipeline";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // WebSocket server for real-time updates on a specific path
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/api/ws'
  });

  wss.on('connection', (ws) => {
    console.log('Pipeline WebSocket client connected');
    pipelineService.setWebSocket(ws);

    ws.on('close', () => {
      console.log('Pipeline WebSocket client disconnected');
    });
  });

  // API Routes
  app.post('/api/pipeline/start', async (req, res) => {
    try {
      const { batchSize = 100 } = req.body;
      
      // Start pipeline execution asynchronously with batch size
      pipelineService.executePipeline(batchSize).catch(error => {
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
      const processedJobs = pipelineService.getProcessedJobs();
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

  app.post('/api/database/initialize', async (req, res) => {
    try {
      console.log('Creating database tables...');
      
      // Get database connection
      const { SQLStorage } = await import('./sql-storage');
      const sqlStorage = new SQLStorage();
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
