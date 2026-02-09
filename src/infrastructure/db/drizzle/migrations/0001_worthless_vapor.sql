ALTER TABLE "groups" ADD COLUMN "invite_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "purchase_history" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_history" ADD CONSTRAINT "purchase_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_invite_code_idx" ON "groups" USING btree ("invite_code");--> statement-breakpoint
CREATE INDEX "items_user_idx" ON "items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "list_items_user_idx" ON "list_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "purchase_history_user_idx" ON "purchase_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shopping_lists_user_idx" ON "shopping_lists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tags_user_idx" ON "tags" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_invite_code_unique" UNIQUE("invite_code");