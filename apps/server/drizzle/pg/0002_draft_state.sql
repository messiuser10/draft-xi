ALTER TABLE "games" ADD COLUMN "paused_remaining_ms" integer;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "rerolls_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "auto_draft" text;