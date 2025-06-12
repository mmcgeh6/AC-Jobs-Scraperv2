import { pgTable, text, serial, integer, boolean, timestamp, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const jobPostings = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  full_text: text("full_text"),
  url: text("url"),
  company_name: text("company_name"),
  brand: text("brand"),
  functional_area: text("functional_area"),
  work_type: text("work_type"),
  location_city: text("location_city"),
  location_state: text("location_state"),
  state_abbrev: text("state_abbrev"),
  zip_code: text("zip_code"),
  country: text("country"),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  location_point: text("location_point"), // POINT geometry as text
  job_details_json: text("job_details_json"),
  status: text("status").default("Active"),
  is_expired: boolean("is_expired").default(false),
  record_created_on: timestamp("record_created_on").defaultNow(),
  created_at: timestamp("created_at").defaultNow(),
  last_seen: timestamp("last_seen").defaultNow(),
  // Internal tracking
  jobID: text("jobID").unique(), // From Algolia
  lastDayToApply: timestamp("lastDayToApply"),
  businessArea: text("businessArea"),
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

export const insertJobPostingSchema = createInsertSchema(jobPostings).omit({
  id: true,
  record_created_on: true,
  created_at: true,
  last_seen: true,
});

export const insertPipelineExecutionSchema = createInsertSchema(pipelineExecutions).omit({
  id: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  timestamp: true,
});

export type JobPosting = typeof jobPostings.$inferSelect;
export type InsertJobPosting = z.infer<typeof insertJobPostingSchema>;
export type PipelineExecution = typeof pipelineExecutions.$inferSelect;
export type InsertPipelineExecution = z.infer<typeof insertPipelineExecutionSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
