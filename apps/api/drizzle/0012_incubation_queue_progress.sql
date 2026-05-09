ALTER TABLE "incubation_jobs" ADD COLUMN "progress_seconds_accumulated" integer DEFAULT 0 NOT NULL;
ALTER TABLE "incubation_jobs" ADD COLUMN "last_progressed_at" timestamp with time zone;
