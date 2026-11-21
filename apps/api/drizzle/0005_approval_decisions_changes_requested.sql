DROP INDEX IF EXISTS "approval_decisions_instance_step_decision_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_decisions_instance_step_approved_unique" ON "approval_decisions" ("approval_instance_id", "step_order") WHERE "decision" = 'APPROVED';
--> statement-breakpoint
ALTER TABLE "venue_requests" ALTER COLUMN "submitted_by_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_requests_submitted_by_idx" ON "venue_requests" ("submitted_by_id");
