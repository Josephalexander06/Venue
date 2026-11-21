DROP INDEX IF EXISTS "approval_decisions_instance_step_decision_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_decisions_instance_step_approved_unique" ON "approval_decisions" ("approval_instance_id", "step_order") WHERE "decision" = 'APPROVED';
