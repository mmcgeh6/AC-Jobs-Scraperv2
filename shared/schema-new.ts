import { pgTable, text, serial, integer, timestamp, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// New simplified job posting listings table for Azure SQL
export const jobPostingListings = pgTable("job_posting_listings", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull().unique(),
  jobUrl: text("job_url").notNull(),
  title: text("title").notNull(),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  locationPoint: text("location_point"), // For geospatial data
  description: text("description"),
  companyName: text("company_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const pipelineExecutions = pgTable("pipeline_executions", {
  id: serial("id").primaryKey(),
  status: text("status").notNull(), // 'running', 'completed', 'failed'
  startTime: timestamp("startTime").notNull(),
  endTime: timestamp("endTime"),
  totalJobs: integer("totalJobs").default(0),
  processedJobs: integer("processedJobs").default(0),
  newJobs: integer("newJobs").default(0),
  removedJobs: integer("removedJobs").default(0),
  errorMessage: text("errorMessage"),
  currentStep: text("currentStep"),
});

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  message: text("message").notNull(),
  level: text("level").notNull(), // 'info', 'warning', 'error', 'success'
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  executionId: integer("executionId").references(() => pipelineExecutions.id),
});

export const insertJobPostingListingSchema = createInsertSchema(jobPostingListings).omit({
  id: true,
  createdAt: true,
});

export const insertPipelineExecutionSchema = createInsertSchema(pipelineExecutions).omit({
  id: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  timestamp: true,
});

export type JobPostingListing = typeof jobPostingListings.$inferSelect;
export type InsertJobPostingListing = z.infer<typeof insertJobPostingListingSchema>;
export type PipelineExecution = typeof pipelineExecutions.$inferSelect;
export type InsertPipelineExecution = z.infer<typeof insertPipelineExecutionSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

// Legacy types for backward compatibility
export type JobPosting = JobPostingListing;
export type InsertJobPosting = InsertJobPostingListing;