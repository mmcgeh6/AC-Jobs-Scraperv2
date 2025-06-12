import { type JobPosting, type InsertJobPosting, type PipelineExecution, type InsertPipelineExecution, type ActivityLog, type InsertActivityLog } from "@shared/schema";
import { AzureSQLStorage } from './azure-sql-storage';

export interface IStorage {
  // Job postings
  getAllJobPostings(): Promise<JobPosting[]>;
  getJobPostingByJobID(jobID: string): Promise<JobPosting | undefined>;
  createJobPosting(job: InsertJobPosting): Promise<JobPosting>;
  deleteJobPosting(jobID: string): Promise<void>;
  deleteJobPostingsByJobIDs(jobIDs: string[]): Promise<void>;
  
  // Pipeline executions
  createPipelineExecution(execution: InsertPipelineExecution): Promise<PipelineExecution>;
  updatePipelineExecution(id: number, updates: Partial<PipelineExecution>): Promise<PipelineExecution>;
  getLatestPipelineExecution(): Promise<PipelineExecution | undefined>;
  
  // Activity logs
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getRecentActivityLogs(limit?: number): Promise<ActivityLog[]>;
  clearActivityLogs(): Promise<void>;
}

export class MemStorage implements IStorage {
  private jobPostings: Map<string, JobPosting> = new Map();
  private pipelineExecutions: Map<number, PipelineExecution> = new Map();
  private activityLogs: ActivityLog[] = [];
  private currentJobId = 1;
  private currentExecutionId = 1;
  private currentLogId = 1;

  async getAllJobPostings(): Promise<JobPosting[]> {
    return Array.from(this.jobPostings.values());
  }

  async getJobPostingByJobID(jobID: string): Promise<JobPosting | undefined> {
    return this.jobPostings.get(jobID);
  }

  async createJobPosting(job: InsertJobPosting): Promise<JobPosting> {
    const newJob: JobPosting = {
      id: this.currentJobId++,
      title: job.title,
      description: job.description || null,
      full_text: job.full_text || null,
      url: job.url || null,
      company_name: job.company_name || null,
      brand: job.brand || null,
      functional_area: job.functional_area || null,
      work_type: job.work_type || null,
      location_city: job.location_city || null,
      location_state: job.location_state || null,
      state_abbrev: job.state_abbrev || null,
      zip_code: job.zip_code || null,
      country: job.country || null,
      latitude: job.latitude || null,
      longitude: job.longitude || null,
      location_point: job.location_point || null,
      job_details_json: job.job_details_json || null,
      status: job.status || "Active",
      is_expired: job.is_expired || false,
      record_created_on: new Date(),
      created_at: new Date(),
      last_seen: new Date(),
      jobID: job.jobID || null,
      lastDayToApply: job.lastDayToApply || null,
      businessArea: job.businessArea || null,
    };
    this.jobPostings.set(job.jobID || String(newJob.id), newJob);
    return newJob;
  }

  async deleteJobPosting(jobID: string): Promise<void> {
    this.jobPostings.delete(jobID);
  }

  async deleteJobPostingsByJobIDs(jobIDs: string[]): Promise<void> {
    jobIDs.forEach(jobID => this.jobPostings.delete(jobID));
  }

  async createPipelineExecution(execution: InsertPipelineExecution): Promise<PipelineExecution> {
    const newExecution: PipelineExecution = {
      ...execution,
      id: this.currentExecutionId++,
      endTime: execution.endTime || null,
      totalJobs: execution.totalJobs || null,
      processedJobs: execution.processedJobs || null,
      newJobs: execution.newJobs || null,
      removedJobs: execution.removedJobs || null,
      errorMessage: execution.errorMessage || null,
      currentStep: execution.currentStep || null,
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

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const newLog: ActivityLog = {
      ...log,
      id: this.currentLogId++,
      timestamp: new Date(),
      executionId: log.executionId || null,
    };
    this.activityLogs.unshift(newLog);
    // Keep only last 100 logs
    if (this.activityLogs.length > 100) {
      this.activityLogs = this.activityLogs.slice(0, 100);
    }
    return newLog;
  }

  async getRecentActivityLogs(limit = 10): Promise<ActivityLog[]> {
    return this.activityLogs.slice(0, limit);
  }

  async clearActivityLogs(): Promise<void> {
    this.activityLogs = [];
  }
}

import { SQLStorage } from "./sql-storage";

// Lazy initialization to ensure environment variables are loaded
let _storage: IStorage | null = null;

export function getStorage(): IStorage {
  if (!_storage) {
    console.log('🔍 Storage initialization check:');
    console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
    console.log('DATABASE_URL value:', process.env.DATABASE_URL ? 'Present' : 'Missing');
    const azureUrl = process.env.AZURE_SQL_URL?.replace(/['"]/g, ''); // Remove quotes
    const dbUrl = process.env.DATABASE_URL?.replace(/['"]/g, ''); // Remove quotes
    console.log('AZURE_SQL_URL:', azureUrl ? 'Present' : 'Missing');
    console.log('DATABASE_URL (cleaned):', dbUrl);
    console.log('Using Azure SQL:', !!azureUrl);

    if (azureUrl || dbUrl?.includes('jdbc:sqlserver:')) {
      console.log('Initializing AzureSQLStorage...');
      _storage = new AzureSQLStorage();
    } else {
      console.log('Falling back to MemStorage');
      _storage = new MemStorage();
    }
    console.log('📊 Storage type selected:', _storage.constructor.name);
  }
  return _storage;
}

// Backward compatibility export
export const storage = new Proxy({} as IStorage, {
  get(target, prop) {
    return getStorage()[prop as keyof IStorage];
  }
});
