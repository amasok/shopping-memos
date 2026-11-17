-- 同期用の列を足す expand マイグレーション（#62 O3。docs/features/offline-support.md）
-- 列とインデックスを足すだけで、既存のコードはそのまま動く。何度流しても壊れないよう、すべて冪等にしている
--
-- updated_at がなかった shopping_lists / list_items は、既存行を created_at で埋めてから NOT NULL・既定値 now() にする
-- （ADD COLUMN に DEFAULT now() を付けると、既存行がマイグレーションの時刻になってしまうため）
ALTER TABLE "shopping_lists" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;--> statement-breakpoint
UPDATE "shopping_lists" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "shopping_lists" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "shopping_lists" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;--> statement-breakpoint
UPDATE "list_items" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "list_items" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "list_items" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "field_modified_at" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "field_modified_at" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD COLUMN IF NOT EXISTS "field_modified_at" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN IF NOT EXISTS "field_modified_at" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_group_updated_idx" ON "items" USING btree ("group_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_user_updated_idx" ON "items" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tags_group_updated_idx" ON "tags" USING btree ("group_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tags_user_updated_idx" ON "tags" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopping_lists_group_updated_idx" ON "shopping_lists" USING btree ("group_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopping_lists_user_updated_idx" ON "shopping_lists" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_items_group_updated_idx" ON "list_items" USING btree ("group_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_items_user_updated_idx" ON "list_items" USING btree ("user_id","updated_at");
