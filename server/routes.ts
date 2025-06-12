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
      const jobs = await storage.getAllJobPostings();
      res.json(jobs);
    } catch (error: any) {
      console.error('Failed to get jobs:', error);
      res.status(500).json({ message: 'Failed to get jobs', error: error.message });
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
