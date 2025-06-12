import { pgTable, text, serial, integer, boolean, timestamp, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const jobPostings = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  jobID: text("jobID").notNull().unique(),
  city: text("city").notNull(),
  country: text("country").notNull(),
  externalPath: text("externalPath").notNull(),
  lastDayToApply: timestamp("lastDayToApply").notNull(),
  title: text("title").notNull(),
  businessArea: text("businessArea").notNull(),
  // AI enriched fields
  parsedCity: text("parsedCity"),
  parsedState: text("parsedState"),
  parsedCountry: text("parsedCountry"),
  // Geocoding fields
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
  createdAt: true,
  updatedAt: true,
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
