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
  if (!pool || !pool.connected) {
    try {
      // Close existing pool if it exists but is not connected
      if (pool && !pool.connected) {
        try {
          await pool.close();
        } catch (e) {
          // Ignore close errors
        }
        pool = null;
      }

      const config = parseJdbcConnectionString(connectionString);
      console.log('Attempting to connect to Azure SQL with config:', {
        server: config.server,
        database: config.database,
        user: config.user,
        port: config.port
      });
      
      pool = new sql.ConnectionPool(config);
      await pool.connect();
      console.log('✅ Successfully connected to Azure SQL Database');
      
      // Handle connection errors
      pool.on('error', (err) => {
        console.error('Azure SQL connection error:', err);
        pool = null;
      });
      
    } catch (error) {
      console.error('❌ Failed to connect to Azure SQL Database:', error);
      pool = null;
      throw error;
    }
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
    
    // Map the job object properties to match the database schema
    request.input('jobID', sql.VarChar, job.jobID);
    request.input('title', sql.VarChar, job.title);
    request.input('description', sql.VarChar, job.description);
    request.input('full_text', sql.VarChar, job.full_text);
    request.input('url', sql.VarChar, job.url);
    request.input('company_name', sql.VarChar, job.company_name);
    request.input('brand', sql.VarChar, job.brand);
    request.input('functional_area', sql.VarChar, job.functional_area);
    request.input('work_type', sql.VarChar, job.work_type);
    request.input('location_city', sql.VarChar, job.location_city);
    request.input('location_state', sql.VarChar, job.location_state);
    request.input('state_abbrev', sql.VarChar, job.state_abbrev);
    request.input('zip_code', sql.VarChar, job.zip_code);
    request.input('country', sql.VarChar, job.country);
    request.input('latitude', sql.Decimal(10, 8), job.latitude ? parseFloat(job.latitude) : null);
    request.input('longitude', sql.Decimal(11, 8), job.longitude ? parseFloat(job.longitude) : null);
    
    // Create geography point if coordinates are available
    const lat = job.latitude ? parseFloat(job.latitude) : null;
    const lng = job.longitude ? parseFloat(job.longitude) : null;
    const hasValidCoords = lat !== null && lng !== null && lat !== 0 && lng !== 0;
    request.input('job_details_json', sql.VarChar, job.job_details_json);
    request.input('status', sql.VarChar, job.status || 'Active');
    request.input('is_expired', sql.Bit, job.is_expired || false);
    request.input('lastDayToApply', sql.DateTime, job.lastDayToApply);
    request.input('businessArea', sql.VarChar, job.businessArea);
    
    let insertQuery;
    if (hasValidCoords) {
      // Use native geography data type for proper geospatial support
      insertQuery = `
        INSERT INTO job_postings (
          jobID, title, description, full_text, url, company_name, brand, functional_area, work_type,
          location_city, location_state, state_abbrev, zip_code, country, latitude, longitude,
          location_point, job_details_json, status, is_expired, lastDayToApply, businessArea
        )
        OUTPUT INSERTED.*
        VALUES (
          @jobID, @title, @description, @full_text, @url, @company_name, @brand, @functional_area, @work_type,
          @location_city, @location_state, @state_abbrev, @zip_code, @country, @latitude, @longitude,
          geography::Point(@latitude, @longitude, 4326), @job_details_json, @status, @is_expired, @lastDayToApply, @businessArea
        )
      `;
    } else {
      // Insert without geography point for invalid coordinates
      insertQuery = `
        INSERT INTO job_postings (
          jobID, title, description, full_text, url, company_name, brand, functional_area, work_type,
          location_city, location_state, state_abbrev, zip_code, country, latitude, longitude,
          job_details_json, status, is_expired, lastDayToApply, businessArea
        )
        OUTPUT INSERTED.*
        VALUES (
          @jobID, @title, @description, @full_text, @url, @company_name, @brand, @functional_area, @work_type,
          @location_city, @location_state, @state_abbrev, @zip_code, @country, @latitude, @longitude,
          @job_details_json, @status, @is_expired, @lastDayToApply, @businessArea
        )
      `;
    }
    
    const result = await request.query(insertQuery);
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