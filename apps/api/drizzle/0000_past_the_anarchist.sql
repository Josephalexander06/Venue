CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."allotment_status_enum" AS ENUM('ACTIVE', 'CANCELLED', 'RELEASED');--> statement-breakpoint
CREATE TYPE "public"."decision_enum" AS ENUM('APPROVED', 'REJECTED', 'CHANGES_REQUESTED');--> statement-breakpoint
CREATE TYPE "public"."event_status_enum" AS ENUM('DRAFT', 'SUBMITTED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."request_status_enum" AS ENUM('SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT', 'CONFIRMED', 'REJECTED', 'SUPERSEDED_CONFLICT', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."role_name_enum" AS ENUM('STUDENT', 'FACULTY', 'HOD', 'PRINCIPAL', 'BURSAR', 'ADMINISTRATOR');--> statement-breakpoint
CREATE TYPE "public"."scope_type_enum" AS ENUM('CREATOR_DEPARTMENT', 'VENUE_DEPARTMENT', 'COLLEGE_WIDE');--> statement-breakpoint
CREATE TYPE "public"."user_account_status" AS ENUM('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_instance_id" uuid NOT NULL,
	"workflow_step_id" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"decision" "decision_enum" NOT NULL,
	"remarks" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_request_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"current_step_order" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"ip_address" varchar(45),
	"user_agent" text,
	"action" varchar(100) NOT NULL,
	"entity_name" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"old_state" jsonb,
	"new_state" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"department_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"expected_attendance" integer NOT NULL,
	"status" "event_status_enum" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_attendance_positive" CHECK ("events"."expected_attendance" > 0)
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" "role_name_enum" NOT NULL,
	"description" text,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"department_id" uuid,
	"venue_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"phone" varchar(20),
	"department_id" uuid NOT NULL,
	"status" "user_account_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"status_reason" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "venue_allotments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_request_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"reserved_range" "tstzrange" NOT NULL,
	"status" "allotment_status_enum" DEFAULT 'ACTIVE' NOT NULL,
	"allotted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	CONSTRAINT "venue_allotments_venue_request_id_unique" UNIQUE("venue_request_id"),
	CONSTRAINT "venue_allotments_range_not_empty" CHECK (not isempty("venue_allotments"."reserved_range"))
);
--> statement-breakpoint
CREATE TABLE "venue_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"setup_buffer_mins" integer DEFAULT 30 NOT NULL,
	"teardown_buffer_mins" integer DEFAULT 30 NOT NULL,
	"effective_range" "tstzrange" GENERATED ALWAYS AS (tstzrange(
          to_timestamp(date_part('epoch', start_time at time zone 'UTC') - setup_buffer_mins * 60),
          to_timestamp(date_part('epoch', end_time at time zone 'UTC') + teardown_buffer_mins * 60),
          '[)'
        )) STORED NOT NULL,
	"status" "request_status_enum" DEFAULT 'SUBMITTED' NOT NULL,
	"current_step_order" integer DEFAULT 1 NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_requests_end_after_start" CHECK ("venue_requests"."end_time" > "venue_requests"."start_time"),
	CONSTRAINT "venue_requests_setup_buffer_non_negative" CHECK ("venue_requests"."setup_buffer_mins" >= 0),
	CONSTRAINT "venue_requests_teardown_buffer_non_negative" CHECK ("venue_requests"."teardown_buffer_mins" >= 0)
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(120) NOT NULL,
	"building" varchar(100) NOT NULL,
	"floor" integer DEFAULT 1 NOT NULL,
	"capacity" integer NOT NULL,
	"facilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"setup_buffer_mins" integer DEFAULT 30 NOT NULL,
	"teardown_buffer_mins" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"department_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_code_unique" UNIQUE("code"),
	CONSTRAINT "venues_capacity_positive" CHECK ("venues"."capacity" > 0),
	CONSTRAINT "venues_setup_buffer_non_negative" CHECK ("venues"."setup_buffer_mins" >= 0),
	CONSTRAINT "venues_teardown_buffer_non_negative" CHECK ("venues"."teardown_buffer_mins" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"step_name" varchar(100) NOT NULL,
	"required_role" "role_name_enum" NOT NULL,
	"scope_type" "scope_type_enum" DEFAULT 'COLLEGE_WIDE' NOT NULL,
	"is_final_allotment_step" boolean DEFAULT false NOT NULL,
	CONSTRAINT "workflow_steps_order_positive" CHECK ("workflow_steps"."step_order" > 0)
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approval_instance_id_approval_instances_id_fk" FOREIGN KEY ("approval_instance_id") REFERENCES "public"."approval_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_venue_request_id_venue_requests_id_fk" FOREIGN KEY ("venue_request_id") REFERENCES "public"."venue_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_workflow_id_approval_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."approval_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_allotments" ADD CONSTRAINT "venue_allotments_venue_request_id_venue_requests_id_fk" FOREIGN KEY ("venue_request_id") REFERENCES "public"."venue_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_allotments" ADD CONSTRAINT "venue_allotments_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_allotments" ADD CONSTRAINT "venue_allotments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_allotments" ADD CONSTRAINT "venue_allotments_allotted_by_users_id_fk" FOREIGN KEY ("allotted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_workflow_id_approval_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."approval_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_approval_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."approval_workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_scope_unique" ON "user_roles" USING btree ("user_id","role_id","department_id","venue_id") NULLS NOT DISTINCT;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_steps_order_unique" ON "workflow_steps" USING btree ("workflow_id","step_order");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_roles_user_id_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "venue_requests_effective_range_idx" ON "venue_requests" USING gist ("venue_id","effective_range");--> statement-breakpoint
CREATE INDEX "venue_requests_status_idx" ON "venue_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "venue_allotments_range_idx" ON "venue_allotments" USING gist ("venue_id","reserved_range");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_name","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_instances_one_active_idx" ON "approval_instances" USING btree ("venue_request_id") WHERE "is_active";--> statement-breakpoint
ALTER TABLE "venue_allotments" ADD CONSTRAINT "no_overlapping_active_allotments" EXCLUDE USING gist ("venue_id" WITH =, "reserved_range" WITH &&) WHERE ("status" = 'ACTIVE');--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER departments_set_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER venues_set_updated_at BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER events_set_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER venue_requests_set_updated_at BEFORE UPDATE ON venue_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER approval_instances_set_updated_at BEFORE UPDATE ON approval_instances FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE OR REPLACE FUNCTION derive_allotment_range() RETURNS trigger AS $$
DECLARE
  request_row venue_requests%ROWTYPE;
BEGIN
  SELECT * INTO request_row FROM venue_requests WHERE id = NEW.venue_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venue request % does not exist', NEW.venue_request_id;
  END IF;
  IF NEW.venue_id <> request_row.venue_id OR NEW.event_id <> request_row.event_id THEN
    RAISE EXCEPTION 'Allotment venue/event must match the venue request';
  END IF;
  NEW.reserved_range := request_row.effective_range;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER venue_allotments_derive_range BEFORE INSERT OR UPDATE ON venue_allotments FOR EACH ROW EXECUTE FUNCTION derive_allotment_range();--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();