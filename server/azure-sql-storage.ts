import sql from 'mssql';
import { IStorage } from './storage';
import { JobPosting, InsertJobPosting, PipelineExecution, InsertPipelineExecution, ActivityLog, InsertActivityLog } from '@shared/schema';

interface AzureJobPosting {
  id: number;
  job_id: string;
  job_url: string;
  title: string;
  city?: string;
  state?: string;
  country?: string;
  zipcode?: string;
  latitude?: string;
  longitude?: string;
  location_point?: string;
  description?: string;
  company_name?: string;
  created_at: Date;
}

function parseJdbcConnectionString(jdbcUrl: string) {
  // Parse JDBC connection string properly
  const parts = jdbcUrl.split(';');
  const serverPart = parts[0].replace('jdbc:sqlserver://', '');
  const [server, port] = serverPart.split(':');
  
  const config: any = {
    server: server,
    port: port ? parseInt(port) : 1433,
    database: 'master',
    user: '',
    password: '',
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  };
  
  // Parse other parameters
  for (let i = 1; i < parts.length; i++) {
    const [key, value] = parts[i].split('=');
    switch (key.toLowerCase()) {
      case 'database':
        config.database = value;
        break;
      case 'user':
        config.user = value;
        break;
      case 'password':
        config.password = value;
        break;
    }
  }
  
  return config;
}

let globalPool: sql.ConnectionPool | null = null;

async function initializeConnection(): Promise<sql.ConnectionPool> {
  if (globalPool && globalPool.connected) {
    return globalPool;
  }

  const jdbcUrl = process.env.AZURE_SQL_URL || process.env.DATABASE_URL;
  if (!jdbcUrl) {
    throw new Error('AZURE_SQL_URL or DATABASE_URL environment variable is not set');
  }

  const config = parseJdbcConnectionString(jdbcUrl);
  globalPool = await sql.connect(config);
  
  console.log('✅ Connected to Azure SQL Database');
  return globalPool;
}

export class AzureSQLStorage implements IStorage {
  private async getPool(): Promise<sql.ConnectionPool> {
    try {
      return await initializeConnection();
    } catch (error) {
      console.error('Failed to connect to Azure SQL:', error);
      throw error;
    }
  }

  private async ensureTableExists(): Promise<void> {
    const pool = await this.getPool();
    const request = pool.request();
    
    const createTableSQL = `
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'job_posting_listings')
      BEGIN
          CREATE TABLE job_posting_listings (
              id INT IDENTITY(1,1) PRIMARY KEY,
              job_id NVARCHAR(255) NOT NULL UNIQUE,
              job_url NVARCHAR(1000) NOT NULL,
              title NVARCHAR(500) NOT NULL,
              city NVARCHAR(100),
              state NVARCHAR(100),
              country NVARCHAR(100),
              zipcode NVARCHAR(20),
              latitude DECIMAL(10, 8),
              longitude DECIMAL(11, 8),
              location_point GEOGRAPHY,
              description NVARCHAR(MAX),
              company_name NVARCHAR(255),
              created_at DATETIME2 DEFAULT GETDATE()
          );

          CREATE INDEX IX_job_posting_listings_job_id ON job_posting_listings(job_id);
          
          CREATE SPATIAL INDEX IX_job_posting_listings_location_point 
          ON job_posting_listings(location_point)
          USING GEOGRAPHY_GRID 
          WITH (GRIDS =(LEVEL_1 = MEDIUM, LEVEL_2 = MEDIUM, LEVEL_3 = MEDIUM, LEVEL_4 = MEDIUM));
      END
    `;

    // Add zipcode column to existing table if it doesn't exist
    const addZipcodeColumnSQL = `
      IF NOT EXISTS (
          SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'job_posting_listings' AND COLUMN_NAME = 'zipcode'
      )
      BEGIN
          ALTER TABLE job_posting_listings 
          ADD zipcode NVARCHAR(20);
      END
    `;

    try {
      await request.query(createTableSQL);
      await request.query(addZipcodeColumnSQL);
      console.log('✅ Azure SQL table job_posting_listings ready');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('Table creation skipped or already exists:', errorMessage);
    }
  }

  private convertAzureToJobPosting(azure: AzureJobPosting): JobPosting {
    return {
      id: azure.id,
      jobId: azure.job_id,
      jobUrl: azure.job_url,
      title: azure.title,
      city: azure.city || null,
      state: azure.state || null,
      country: azure.country || null,
      zipcode: azure.zipcode || null,
      latitude: azure.latitude || null,
      longitude: azure.longitude || null,
      locationPoint: azure.location_point || null,
      description: azure.description || null,
      companyName: azure.company_name || null,
      createdAt: azure.created_at,
    };
  }

  async getAllJobPostings(): Promise<JobPosting[]> {
    await this.ensureTableExists();
    const pool = await this.getPool();
    const request = pool.request();
    
    try {
      const result = await request.query('SELECT * FROM job_posting_listings ORDER BY id DESC');
      return result.recordset.map(this.convertAzureToJobPosting);
    } catch (error) {
      console.error('Failed to get job postings:', error);
      return [];
    }
  }

  async getJobPostingByJobID(jobID: string): Promise<JobPosting | undefined> {
    await this.ensureTableExists();
    const pool = await this.getPool();
    const request = pool.request();
    
    try {
      // Ensure jobID is a valid string
      const validJobId = String(jobID || '').trim();
      if (!validJobId) {
        return undefined;
      }
      
      request.input('jobId', sql.NVarChar, validJobId);
      const result = await request.query('SELECT * FROM job_posting_listings WHERE job_id = @jobId');
      
      if (result.recordset.length > 0) {
        return this.convertAzureToJobPosting(result.recordset[0]);
      }
      return undefined;
    } catch (error) {
      console.error('Failed to get job posting by ID:', error);
      return undefined;
    }
  }

  async createJobPosting(job: InsertJobPosting): Promise<JobPosting> {
    await this.ensureTableExists();
    const pool = await this.getPool();
    const request = pool.request();

    try {
      // Ensure all required fields are valid strings
      const validatedJob = {
        jobId: String(job.jobId || '').trim(),
        jobUrl: String(job.jobUrl || '').trim(),
        title: String(job.title || '').trim(),
        city: job.city ? String(job.city).trim() : null,
        state: job.state ? String(job.state).trim() : null,
        country: job.country ? String(job.country).trim() : null,
        zipcode: job.zipcode ? String(job.zipcode).trim() : null,
        latitude: job.latitude ? parseFloat(String(job.latitude)) : null,
        longitude: job.longitude ? parseFloat(String(job.longitude)) : null,
        description: job.description ? String(job.description).trim() : null,
        companyName: job.companyName ? String(job.companyName).trim() : null
      };

      // Validate required fields
      if (!validatedJob.jobId || !validatedJob.jobUrl || !validatedJob.title) {
        throw new Error('Missing required fields: jobId, jobUrl, or title');
      }

      request.input('jobId', sql.NVarChar, validatedJob.jobId);
      request.input('jobUrl', sql.NVarChar, validatedJob.jobUrl);
      request.input('title', sql.NVarChar, validatedJob.title);
      request.input('city', sql.NVarChar, validatedJob.city);
      request.input('state', sql.NVarChar, validatedJob.state);
      request.input('country', sql.NVarChar, validatedJob.country);
      request.input('zipcode', sql.NVarChar, validatedJob.zipcode);
      request.input('latitude', sql.Decimal(10, 8), validatedJob.latitude);
      request.input('longitude', sql.Decimal(11, 8), validatedJob.longitude);
      request.input('description', sql.NVarChar, validatedJob.description);
      request.input('companyName', sql.NVarChar, validatedJob.companyName);

      // Create location point if coordinates exist - store as text
      if (validatedJob.latitude && validatedJob.longitude) {
        const locationPoint = `POINT(${validatedJob.longitude} ${validatedJob.latitude})`;
        request.input('locationPoint', sql.NVarChar, locationPoint);
      } else {
        request.input('locationPoint', sql.NVarChar, null);
      }

      const insertSQL = `
        INSERT INTO job_posting_listings 
        (job_id, job_url, title, city, state, country, zipcode, latitude, longitude, location_point, description, company_name)
        OUTPUT INSERTED.*
        VALUES (@jobId, @jobUrl, @title, @city, @state, @country, @zipcode, @latitude, @longitude, @locationPoint, @description, @companyName)
      `;

      const result = await request.query(insertSQL);
      return this.convertAzureToJobPosting(result.recordset[0]);
    } catch (error) {
      console.error('Failed to create job posting:', error);
      throw error;
    }
  }

  async deleteJobPosting(jobID: string): Promise<void> {
    await this.ensureTableExists();
    const pool = await this.getPool();
    const request = pool.request();

    try {
      request.input('jobId', sql.NVarChar, jobID);
      await request.query('DELETE FROM job_posting_listings WHERE job_id = @jobId');
    } catch (error) {
      console.error('Failed to delete job posting:', error);
      throw error;
    }
  }

  async deleteJobPostingsByJobIDs(jobIDs: string[]): Promise<void> {
    if (jobIDs.length === 0) return;
    
    await this.ensureTableExists();
    const pool = await this.getPool();
    const request = pool.request();

    try {
      const placeholders = jobIDs.map((_, index) => `@jobId${index}`).join(',');
      jobIDs.forEach((jobId, index) => {
        request.input(`jobId${index}`, sql.NVarChar, jobId);
      });

      await request.query(`DELETE FROM job_posting_listings WHERE job_id IN (${placeholders})`);
    } catch (error) {
      console.error('Failed to delete job postings by IDs:', error);
      throw error;
    }
  }

  // Pipeline execution methods - using in-memory storage for simplicity
  private pipelineExecutions: Map<number, PipelineExecution> = new Map();
  private currentExecutionId = 1;

  async createPipelineExecution(execution: InsertPipelineExecution): Promise<PipelineExecution> {
    const newExecution: PipelineExecution = {
      id: this.currentExecutionId++,
      ...execution,
    };
    this.pipelineExecutions.set(newExecution.id, newExecution);
    return newExecution;
  }

  async updatePipelineExecution(id: number, updates: Partial<PipelineExecution>): Promise<PipelineExecution> {
    const existing = this.pipelineExecutions.get(id);
    if (!existing) {
      throw new Error(`Pipeline execution with id ${id} not found`);
    }
    const updated = { ...existing, ...updates };
    this.pipelineExecutions.set(id, updated);
    return updated;
  }

  async getLatestPipelineExecution(): Promise<PipelineExecution | undefined> {
    const executions = Array.from(this.pipelineExecutions.values());
    return executions.sort((a, b) => b.id - a.id)[0];
  }

  // Activity log methods - using in-memory storage for simplicity
  private activityLogs: ActivityLog[] = [];
  private currentLogId = 1;

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const newLog: ActivityLog = {
      id: this.currentLogId++,
      timestamp: new Date(),
      ...log,
    };
    this.activityLogs.push(newLog);
    return newLog;
  }

  async getRecentActivityLogs(limit = 20): Promise<ActivityLog[]> {
    return this.activityLogs
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  async clearActivityLogs(): Promise<void> {
    this.activityLogs = [];
  }
}