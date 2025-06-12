import { jobPostings, pipelineExecutions, activityLogs, type JobPosting, type InsertJobPosting, type PipelineExecution, type InsertPipelineExecution, type ActivityLog, type InsertActivityLog } from "@shared/schema";

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
      ...job,
      id: this.currentJobId++,
      parsedCity: job.parsedCity || null,
      parsedState: job.parsedState || null,
      parsedCountry: job.parsedCountry || null,
      latitude: job.latitude || null,
      longitude: job.longitude || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.jobPostings.set(job.jobID, newJob);
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

export const storage = new MemStorage();
