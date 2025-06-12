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
  const serverMatch = jdbcUrl.match(/:\/\/(.[^:]+):(\d+)/);
  const databaseMatch = jdbcUrl.match(/database=([^;]+)/);
  const userMatch = jdbcUrl.match(/user=([^;]+)/);
  const passwordMatch = jdbcUrl.match(/password=([^;]+)/);

  if (!serverMatch || !databaseMatch || !userMatch || !passwordMatch) {
    throw new Error("Invalid JDBC connection string format. Could not parse all required components.");
  }

  return {
    server: serverMatch[1],
    port: parseInt(serverMatch[2], 10),
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

const getConnectionString = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set');
    console.error('Available environment variables:', Object.keys(process.env).filter(key => key.startsWith('DATABASE')));
  }
  return connectionString;
};

let pool: sql.ConnectionPool | null = null;

async function initializeConnection(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) {
    return pool;
  }

  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not defined in environment variables.");
  }
  
  try {
    const config = parseJdbcConnectionString(connectionString);
    console.log('Attempting to connect to Azure SQL with config:', {
      server: config.server,
      database: config.database,
      user: config.user,
      port: config.port
    });
    
    pool = new sql.ConnectionPool(config);
    
    pool.on('error', (err) => {
      console.error('Azure SQL connection error:', err);
      pool = null; // Reset pool on error
    });

    await pool.connect();
    console.log('✅ Successfully connected to Azure SQL Database');
    
    return pool;
  } catch (error) {
    console.error('❌ Failed to connect to Azure SQL Database:', error);
    pool = null;
    throw error;
  }
}

export class SQLStorage implements IStorage {
  private async getPool(): Promise<sql.ConnectionPool> {
    if (!pool || !pool.connected) {
      return initializeConnection();
    }
    return pool;
  }

  async getAllJobPostings(): Promise<JobPosting[]> {
    const pool = await this.getPool();
    const request = pool.request();
    
    // First, let's check what columns actually exist in the table
    try {
      console.log('=== CHECKING DATABASE SCHEMA ===');
      const schemaQuery = `
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'job_postings' 
        ORDER BY ORDINAL_POSITION
      `;
      const schemaResult = await request.query(schemaQuery);
      console.log('Database columns found:');
      schemaResult.recordset.forEach(col => {
        console.log(`  - ${col.COLUMN_NAME}: ${col.DATA_TYPE} (nullable: ${col.IS_NULLABLE})`);
      });
      console.log('=== END SCHEMA CHECK ===');
      
      const result = await request.query('SELECT * FROM job_postings ORDER BY id DESC OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY');
      return result.recordset;
    } catch (error) {
      console.error('Failed to query job_postings table:', error);
      return [];
    }
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
    
    const jobIdString = String(job.jobID);
    console.log(`[SQLStorage] Preparing to insert job: ${jobIdString}`);

    try {
      request.input('jobID', sql.VarChar(50), jobIdString);
      request.input('title', sql.NVarChar(500), job.title || '');
      request.input('description', sql.NVarChar(sql.MAX), job.description || null);
      request.input('full_text', sql.NVarChar(sql.MAX), job.full_text || null);
      request.input('url', sql.VarChar(1000), job.url || null);
      request.input('company_name', sql.NVarChar(200), job.company_name || null);
      request.input('brand', sql.NVarChar(200), job.brand || null);
      request.input('functional_area', sql.NVarChar(200), job.functional_area || null);
      request.input('work_type', sql.NVarChar(100), job.work_type || null);
      request.input('location_city', sql.NVarChar(100), job.location_city || null);
      request.input('location_state', sql.NVarChar(100), job.location_state || null);
      request.input('state_abbrev', sql.NVarChar(10), job.state_abbrev || null);
      request.input('zip_code', sql.VarChar(20), job.zip_code || null);
      request.input('country', sql.NVarChar(100), job.country || null);
      request.input('latitude', sql.Decimal(10, 8), job.latitude ? parseFloat(String(job.latitude)) : null);
      request.input('longitude', sql.Decimal(11, 8), job.longitude ? parseFloat(String(job.longitude)) : null);
      request.input('job_details_json', sql.NVarChar(sql.MAX), job.job_details_json || null);
      request.input('status', sql.VarChar(50), job.status || 'Active');
      request.input('is_expired', sql.Bit, job.is_expired || false);
      request.input('lastDayToApply', sql.DateTime2, job.lastDayToApply ? new Date(job.lastDayToApply) : null);
      request.input('businessArea', sql.NVarChar(200), job.businessArea || null);

      // Handle geospatial data
      request.input('location_point', sql.NVarChar, job.location_point);

      const insertQuery = `
        INSERT INTO job_postings (
          jobID, title, description, full_text, url, company_name, brand, functional_area, work_type,
          location_city, location_state, state_abbrev, zip_code, country, latitude, longitude, location_point,
          job_details_json, status, is_expired, lastDayToApply, businessArea
        )
        OUTPUT INSERTED.*
        VALUES (
          @jobID, @title, @description, @full_text, @url, @company_name, @brand, @functional_area, @work_type,
          @location_city, @location_state, @state_abbrev, @zip_code, @country, @latitude, @longitude, 
          IIF(@location_point IS NOT NULL, geography::STPointFromText(@location_point, 4326), NULL),
          @job_details_json, @status, @is_expired, @lastDayToApply, @businessArea
        )
      `;
      
      console.log(`[SQLStorage] Executing insert for job: ${jobIdString}`);
      const result = await request.query(insertQuery);
      console.log(`[SQLStorage] Successfully inserted job: ${jobIdString}`);
      
      return result.recordset[0];

    } catch (error) {
      console.error(`[SQLStorage] Error inserting job ${jobIdString}:`, error);
      throw error;
    }
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
    for (const key in updates) {
        if (Object.prototype.hasOwnProperty.call(updates, key) && key !== 'id') {
            const value = updates[key as keyof typeof updates];
            const paramName = `param_${key}`;
            
            let type;
            switch(typeof value) {
                case 'string': type = sql.NVarChar(sql.MAX); break;
                case 'number': type = sql.Int; break;
                case 'boolean': type = sql.Bit; break;
                case 'object': 
                    if (value instanceof Date) type = sql.DateTime2;
                    else type = sql.NVarChar(sql.MAX);
                    break;
                default: type = sql.NVarChar(sql.MAX);
            }
            
            request.input(paramName, type, value);
            updateFields.push(`${key} = @${paramName}`);
        }
    }
    
    if (updateFields.length === 0) {
        const res = await pool.request().input('id', sql.Int, id).query('SELECT * FROM pipeline_executions WHERE id = @id');
        return res.recordset[0];
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
    
    request.input('message', sql.NVarChar(sql.MAX), log.message);
    request.input('level', sql.VarChar(50), log.level);
    request.input('timestamp', sql.DateTime2, new Date());
    request.input('executionId', sql.Int, log.executionId)
    
    const result = await request.query(`
      INSERT INTO activity_logs (message, level, timestamp, executionId)
      OUTPUT INSERTED.*
      VALUES (@message, @level, @timestamp, @executionId)
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