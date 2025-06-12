import sql from "mssql";
import type {
  JobPosting,
  InsertJobPosting,
  PipelineExecution,
  InsertPipelineExecution,
  ActivityLog,
  InsertActivityLog,
} from "../shared/schema";
import type { IStorage } from "./storage";

// Parse JDBC connection string to SQL Server config
function parseJdbcConnectionString(jdbcUrl: string) {
  // Extract connection parameters from JDBC URL
  const serverMatch = jdbcUrl.match(/\/\/([^:]+):(\d+)/);
  const databaseMatch = jdbcUrl.match(/database=([^;]+)/);
  const userMatch = jdbcUrl.match(/user=([^;]+)/);
  const passwordMatch = jdbcUrl.match(/password=([^;]+)/);
  
  if (!serverMatch || !databaseMatch || !userMatch || !passwordMatch) {
    throw new Error("Invalid JDBC connection string format");
  }

  return {
    server: serverMatch[1],
    port: parseInt(serverMatch[2]),
    database: databaseMatch[1],
    user: userMatch[1],
    password: passwordMatch[1],
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true,
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
  };
}

const connectionString = process.env.DATABASE_URL || "jdbc:sqlserver://acnajobs.database.windows.net:1433;database=ac jobs scraper;user=CloudSAde530614@acnajobs;password=@pmP$@5UmMcZS8AX;encrypt=true;trustServerCertificate=false;hostNameInCertificate=*.database.windows.net;loginTimeout=30;";

let pool: sql.ConnectionPool;

async function initializeConnection() {
  if (!pool) {
    const config = parseJdbcConnectionString(connectionString);
    pool = new sql.ConnectionPool(config);
    await pool.connect();
    console.log('Connected to Azure SQL Database');
  }
  return pool;
}

export class SQLStorage implements IStorage {
  private async getPool() {
    return await initializeConnection();
  }

  async getAllJobPostings(): Promise<JobPosting[]> {
    const pool = await this.getPool();
    const request = pool.request();
    const result = await request.query('SELECT * FROM job_postings ORDER BY id DESC');
    return result.recordset;
  }

  async getJobPostingByJobID(jobID: string): Promise<JobPosting | undefined> {
    const pool = await this.getPool();
    const request = pool.request();
    request.input('jobID', sql.VarChar, jobID);
    const result = await request.query('SELECT * FROM job_postings WHERE jobID = @jobID');
    return result.recordset[0];
  }

  async createJobPosting(job: InsertJobPosting): Promise<JobPosting> {
    const pool = await this.getPool();
    const request = pool.request();
    
    request.input('jobID', sql.VarChar, job.jobID);
    request.input('title', sql.VarChar, job.title);
    request.input('businessArea', sql.VarChar, job.businessArea);
    request.input('city', sql.VarChar, job.city);
    request.input('state', sql.VarChar, job.state);
    request.input('country', sql.VarChar, job.country);
    request.input('externalPath', sql.VarChar, job.externalPath);
    request.input('lastDayToApply', sql.VarChar, job.lastDayToApply);
    request.input('latitude', sql.VarChar, job.latitude);
    request.input('longitude', sql.VarChar, job.longitude);
    
    const result = await request.query(`
      INSERT INTO job_postings (jobID, title, businessArea, city, state, country, externalPath, lastDayToApply, latitude, longitude)
      OUTPUT INSERTED.*
      VALUES (@jobID, @title, @businessArea, @city, @state, @country, @externalPath, @lastDayToApply, @latitude, @longitude)
    `);
    return result.recordset[0];
  }
  
  async deleteJobPosting(jobID: string): Promise<void> {
    const pool = await this.getPool();
    const request = pool.request();
    request.input('jobID', sql.VarChar, jobID);
    await request.query('DELETE FROM job_postings WHERE jobID = @jobID');
  }

  async deleteJobPostingsByJobIDs(jobIDs: string[]): Promise<void> {
    if (jobIDs.length === 0) return;
    const pool = await this.getPool();
    const request = pool.request();
    const nonNullJobIds = jobIDs.filter((id): id is string => id !== null);
    if (nonNullJobIds.length > 0) {
      const placeholders = nonNullJobIds.map((_, i) => `@jobID${i}`).join(',');
      nonNullJobIds.forEach((id, i) => {
        request.input(`jobID${i}`, sql.VarChar, id);
      });
      await request.query(`DELETE FROM job_postings WHERE jobID IN (${placeholders})`);
    }
  }

  async createPipelineExecution(execution: InsertPipelineExecution): Promise<PipelineExecution> {
    const pool = await this.getPool();
    const request = pool.request();
    
    request.input('status', sql.VarChar, execution.status);
    request.input('startTime', sql.DateTime, execution.startTime);
    request.input('endTime', sql.DateTime, execution.endTime || null);
    request.input('totalJobs', sql.Int, execution.totalJobs);
    request.input('processedJobs', sql.Int, execution.processedJobs);
    request.input('newJobs', sql.Int, execution.newJobs);
    request.input('removedJobs', sql.Int, execution.removedJobs);
    request.input('currentStep', sql.VarChar, execution.currentStep);
    request.input('errorMessage', sql.VarChar, execution.errorMessage || null);
    
    const result = await request.query(`
      INSERT INTO pipeline_executions (status, startTime, endTime, totalJobs, processedJobs, newJobs, removedJobs, currentStep, errorMessage)
      OUTPUT INSERTED.*
      VALUES (@status, @startTime, @endTime, @totalJobs, @processedJobs, @newJobs, @removedJobs, @currentStep, @errorMessage)
    `);
    return result.recordset[0];
  }

  async updatePipelineExecution(id: number, updates: Partial<PipelineExecution>): Promise<PipelineExecution> {
    const pool = await this.getPool();
    const request = pool.request();
    
    request.input('id', sql.Int, id);
    
    const updateFields: string[] = [];
    if (updates.status !== undefined) {
      request.input('status', sql.VarChar, updates.status);
      updateFields.push('status = @status');
    }
    if (updates.endTime !== undefined) {
      request.input('endTime', sql.DateTime, updates.endTime);
      updateFields.push('endTime = @endTime');
    }
    if (updates.totalJobs !== undefined) {
      request.input('totalJobs', sql.Int, updates.totalJobs);
      updateFields.push('totalJobs = @totalJobs');
    }
    if (updates.processedJobs !== undefined) {
      request.input('processedJobs', sql.Int, updates.processedJobs);
      updateFields.push('processedJobs = @processedJobs');
    }
    if (updates.newJobs !== undefined) {
      request.input('newJobs', sql.Int, updates.newJobs);
      updateFields.push('newJobs = @newJobs');
    }
    if (updates.removedJobs !== undefined) {
      request.input('removedJobs', sql.Int, updates.removedJobs);
      updateFields.push('removedJobs = @removedJobs');
    }
    if (updates.currentStep !== undefined) {
      request.input('currentStep', sql.VarChar, updates.currentStep);
      updateFields.push('currentStep = @currentStep');
    }
    if (updates.errorMessage !== undefined) {
      request.input('errorMessage', sql.VarChar, updates.errorMessage);
      updateFields.push('errorMessage = @errorMessage');
    }
    
    const result = await request.query(`
      UPDATE pipeline_executions 
      SET ${updateFields.join(', ')}
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
    return result.recordset[0];
  }

  async getLatestPipelineExecution(): Promise<PipelineExecution | undefined> {
    const pool = await this.getPool();
    const request = pool.request();
    const result = await request.query('SELECT TOP 1 * FROM pipeline_executions ORDER BY id DESC');
    return result.recordset[0];
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const pool = await this.getPool();
    const request = pool.request();
    
    request.input('message', sql.VarChar, log.message);
    request.input('level', sql.VarChar, log.level);
    request.input('timestamp', sql.DateTime, log.timestamp);
    
    const result = await request.query(`
      INSERT INTO activity_logs (message, level, timestamp)
      OUTPUT INSERTED.*
      VALUES (@message, @level, @timestamp)
    `);
    return result.recordset[0];
  }
  
  async getRecentActivityLogs(limit = 20): Promise<ActivityLog[]> {
    const pool = await this.getPool();
    const request = pool.request();
    request.input('limit', sql.Int, limit);
    const result = await request.query('SELECT TOP (@limit) * FROM activity_logs ORDER BY id DESC');
    return result.recordset;
  }

  async clearActivityLogs(): Promise<void> {
    const pool = await this.getPool();
    const request = pool.request();
    await request.query('DELETE FROM activity_logs');
  }
}