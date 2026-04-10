CREATE TABLE "codoc_resolved_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"codoc_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"value" jsonb,
	"state" text NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "codoc_resolved_fields" ADD CONSTRAINT "codoc_resolved_fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codoc_resolved_fields" ADD CONSTRAINT "codoc_resolved_fields_codoc_id_codocs_id_fk" FOREIGN KEY ("codoc_id") REFERENCES "public"."codocs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "codoc_resolved_fields_ws_node_idx" ON "codoc_resolved_fields" USING btree ("workspace_id","node_id");--> statement-breakpoint
ALTER TABLE "codocs" DROP COLUMN "resolved_value";--> statement-breakpoint
ALTER TABLE "codocs" DROP COLUMN "node_state";