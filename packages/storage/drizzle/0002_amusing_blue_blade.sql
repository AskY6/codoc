CREATE TABLE "thread_codocs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"codoc_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "thread_codocs" ADD CONSTRAINT "thread_codocs_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_codocs" ADD CONSTRAINT "thread_codocs_codoc_id_codocs_id_fk" FOREIGN KEY ("codoc_id") REFERENCES "public"."codocs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "thread_codocs_thread_codoc_idx" ON "thread_codocs" USING btree ("thread_id","codoc_id");