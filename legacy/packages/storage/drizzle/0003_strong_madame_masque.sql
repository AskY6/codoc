CREATE TABLE "thread_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "thread_agents" ADD CONSTRAINT "thread_agents_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "thread_agents_thread_agent_idx" ON "thread_agents" USING btree ("thread_id","agent_id");--> statement-breakpoint
ALTER TABLE "chat_threads" DROP COLUMN "agent_id";