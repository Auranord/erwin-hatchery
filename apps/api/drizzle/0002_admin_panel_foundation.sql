CREATE UNIQUE INDEX IF NOT EXISTS "roles_user_id_role_idx" ON "roles" ("user_id","role");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_action_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "target_user_id" uuid,
  "action_type" text NOT NULL,
  "request_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_action_logs_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
