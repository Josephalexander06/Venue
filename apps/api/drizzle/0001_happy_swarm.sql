CREATE UNIQUE INDEX "approval_workflows_one_default_idx" ON "approval_workflows" USING btree ("is_default") WHERE "approval_workflows"."is_default";--> statement-breakpoint
CREATE INDEX "events_creator_idx" ON "events" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "events_status_idx" ON "events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "venue_requests_event_idx" ON "venue_requests" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "venue_requests_venue_status_idx" ON "venue_requests" USING btree ("venue_id","status");--> statement-breakpoint
CREATE INDEX "venues_active_idx" ON "venues" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "venues_department_idx" ON "venues" USING btree ("department_id");