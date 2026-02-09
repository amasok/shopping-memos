CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_links" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"used_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invite_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "item_tags" (
	"item_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "item_tags_item_id_tag_id_pk" PRIMARY KEY("item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"memo" text,
	"group_id" text,
	"purchased_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"id" text PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"memo" text,
	"tag_ids" text[],
	"group_id" text,
	"checked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_history" (
	"id" text PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"location" text,
	"item_ids" text[],
	"group_id" text,
	"purchased_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_history_list_id_unique" UNIQUE("list_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"group_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"operation" text NOT NULL,
	"payload" text NOT NULL,
	"local_id" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"group_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_history" ADD CONSTRAINT "purchase_history_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_user_idx" ON "group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "invite_links_group_idx" ON "invite_links" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "items_group_idx" ON "items" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "items_purchased_idx" ON "items" USING btree ("purchased_at");--> statement-breakpoint
CREATE INDEX "list_items_list_idx" ON "list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "purchase_history_group_idx" ON "purchase_history" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "purchase_history_purchased_idx" ON "purchase_history" USING btree ("purchased_at");--> statement-breakpoint
CREATE INDEX "shopping_lists_group_idx" ON "shopping_lists" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "shopping_lists_status_idx" ON "shopping_lists" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_operations_user_idx" ON "sync_operations" USING btree ("user_id","synced_at");--> statement-breakpoint
CREATE INDEX "sync_operations_entity_idx" ON "sync_operations" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "tags_group_idx" ON "tags" USING btree ("group_id");