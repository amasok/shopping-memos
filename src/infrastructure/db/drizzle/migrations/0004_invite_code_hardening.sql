CREATE TABLE "invite_code_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "invite_code_expires_at" timestamp DEFAULT now() + interval '7 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_code_attempts" ADD CONSTRAINT "invite_code_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_code_attempts_user_attempted_idx" ON "invite_code_attempts" USING btree ("user_id","attempted_at");