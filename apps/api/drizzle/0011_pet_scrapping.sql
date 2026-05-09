ALTER TABLE "pets" ADD COLUMN "is_scrapped" boolean DEFAULT false NOT NULL;
ALTER TABLE "pets" ADD COLUMN "scrapped_at" timestamp with time zone;
