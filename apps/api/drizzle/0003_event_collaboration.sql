CREATE TABLE IF NOT EXISTS "event_organizers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "assigned_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "event_organizers_event_user_unique" ON "event_organizers" ("event_id", "user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_organizers_user_idx" ON "event_organizers" ("user_id");--> statement-breakpoint

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "faculty_coordinator_id" uuid;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_faculty_coordinator_id_users_id_fk'
  ) THEN
    ALTER TABLE "events" ADD CONSTRAINT "events_faculty_coordinator_id_users_id_fk" FOREIGN KEY ("faculty_coordinator_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_faculty_coordinator_idx" ON "events" ("faculty_coordinator_id");--> statement-breakpoint

ALTER TABLE "venue_requests" ADD COLUMN IF NOT EXISTS "submitted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN IF NOT EXISTS "requires_faculty_endorsement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN IF NOT EXISTS "faculty_endorser_id" uuid;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN IF NOT EXISTS "faculty_endorsed_at" timestamp with time zone;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venue_requests_submitted_by_id_users_id_fk'
  ) THEN
    ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venue_requests_faculty_endorser_id_users_id_fk'
  ) THEN
    ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_faculty_endorser_id_users_id_fk" FOREIGN KEY ("faculty_endorser_id") REFERENCES "public"."users"("id");
  END IF;
END $$;--> statement-breakpoint

UPDATE "venue_requests"
SET "submitted_by_id" = "events"."creator_id"
FROM "events"
WHERE "venue_requests"."event_id" = "events"."id"
  AND "venue_requests"."submitted_by_id" IS NULL;--> statement-breakpoint

ALTER TABLE "approval_decisions" ALTER COLUMN "workflow_step_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD COLUMN IF NOT EXISTS "step_order" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD COLUMN IF NOT EXISTS "step_name" varchar(100) DEFAULT 'Approval' NOT NULL;--> statement-breakpoint

UPDATE "approval_decisions"
SET "step_order" = "workflow_steps"."step_order",
    "step_name" = "workflow_steps"."step_name"
FROM "workflow_steps"
WHERE "approval_decisions"."workflow_step_id" = "workflow_steps"."id";--> statement-breakpoint

DROP INDEX IF EXISTS "approval_decisions_step_decision_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_decisions_instance_step_decision_unique" ON "approval_decisions" ("approval_instance_id", "step_order", "decision");
