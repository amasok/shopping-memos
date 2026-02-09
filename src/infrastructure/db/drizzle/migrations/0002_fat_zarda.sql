ALTER TABLE "purchase_history" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "purchase_history" CASCADE;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD COLUMN "purchased_at" timestamp;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD COLUMN "location" text;--> statement-breakpoint
CREATE INDEX "shopping_lists_purchased_idx" ON "shopping_lists" USING btree ("purchased_at");