-- Better Auth 用のテーブルと列を足す expand マイグレーション（#61 A2。docs/features/passkey-email-auth.md の「### DB スキーマ」）
-- 足すだけで、Auth.js（今のコード）はそのまま動く。Auth.js のテーブル（accounts / sessions / verification_tokens）と
-- users.email_verified・users.image には触らない（contract の A6 で消す）。何度流しても壊れないよう、すべて冪等にしている
--
-- users のデータの更新:
--   1. email を lower(trim(email)) にそろえる。そろえると重複する行があれば、何も変えずに止める（手で解消してから流し直す）
--   2. email_verified_flag（boolean）を足し、email_verified（timestamp）が NULL でない行を true にする
--   3. name が NULL の行を '' にする（制約は付けない。今の画面は NULL と '' を同じく空で表示する）
--
-- drizzle は未適用のマイグレーションを 1 トランザクションで流す。users の行ロックの後ろに
-- アプリのクエリが詰まらないよう、ロックを 5 秒待って取れなければ失敗させる（やり直せばよい）
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DO $$
DECLARE
  duplicated integer;
BEGIN
  SELECT count(*) INTO duplicated FROM (
    SELECT lower(trim("email")) FROM "users" GROUP BY lower(trim("email")) HAVING count(*) > 1
  ) AS d;
  IF duplicated > 0 THEN
    RAISE EXCEPTION 'users.email を正規化すると重複するアドレスが % 件あります。手で解消してから流し直してください', duplicated;
  END IF;
END $$;--> statement-breakpoint
UPDATE "users" SET "email" = lower(trim("email")) WHERE "email" <> lower(trim("email"));--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_flag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "users" SET "email_verified_flag" = true WHERE "email_verified" IS NOT NULL AND "email_verified_flag" = false;--> statement-breakpoint
UPDATE "users" SET "name" = '' WHERE "name" IS NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token"),
	CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id"),
	CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "otp_events" (
	"id" text PRIMARY KEY NOT NULL,
	"email_hash" text,
	"ip" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "otp_events_kind_check" CHECK ("otp_events"."kind" in ('sent', 'attempted', 'locked', 'unlocked', 'notified', 'alerted')),
	CONSTRAINT "otp_events_email_hash_check" CHECK ("otp_events"."kind" = 'alerted' or "otp_events"."email_hash" is not null)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkeys_user_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_events_email_kind_created_idx" ON "otp_events" USING btree ("email_hash","kind","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_events_email_ip_kind_created_idx" ON "otp_events" USING btree ("email_hash","ip","kind","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_events_kind_created_idx" ON "otp_events" USING btree ("kind","created_at");
