ALTER TABLE "venues" ADD COLUMN "in_maintenance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_maintenance_inactive" CHECK (not ("venues"."is_active" and "venues"."in_maintenance"));
