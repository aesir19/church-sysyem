ALTER TABLE "public"."collections"
ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();
