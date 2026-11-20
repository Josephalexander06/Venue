ALTER TABLE "venues" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_workflow_id_approval_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."approval_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_step_decision_unique" ON "approval_decisions" USING btree ("approval_instance_id","workflow_step_id","decision");--> statement-breakpoint
CREATE INDEX "approval_decisions_instance_idx" ON "approval_decisions" USING btree ("approval_instance_id","decided_at");--> statement-breakpoint
CREATE INDEX "approval_decisions_approver_idx" ON "approval_decisions" USING btree ("approver_id");--> statement-breakpoint
CREATE INDEX "approval_instances_request_idx" ON "approval_instances" USING btree ("venue_request_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_instances_active_idx" ON "approval_instances" USING btree ("venue_request_id","is_active");--> statement-breakpoint
CREATE INDEX "venues_workflow_idx" ON "venues" USING btree ("workflow_id");