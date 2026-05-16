CREATE TABLE IF NOT EXISTS "user_hat_unlocks" (
	"user_id" uuid NOT NULL,
	"hat_id" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_type" text DEFAULT 'unknown' NOT NULL,
	"source_id" uuid,
	CONSTRAINT "user_hat_unlocks_user_id_hat_id_pk" PRIMARY KEY("user_id","hat_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_hat_unlocks" ADD CONSTRAINT "user_hat_unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_hat_unlocks" ADD CONSTRAINT "user_hat_unlocks_hat_id_hats_id_fk" FOREIGN KEY ("hat_id") REFERENCES "public"."hats"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "user_hat_unlocks" ("user_id", "hat_id", "unlocked_at", "source_type", "source_id")
SELECT "user_id", "hat_id", min("created_at"), 'legacy_hat_inventory', null
FROM "hat_inventory_slots"
GROUP BY "user_id", "hat_id"
ON CONFLICT ("user_id", "hat_id") DO NOTHING;
--> statement-breakpoint
DROP TABLE "hat_inventory_slots";
--> statement-breakpoint
DELETE FROM "inventory_dimensions" WHERE "inventory_kind" = 'hats';
