-- CreateTable
CREATE TABLE "public"."expenses" (
    "id" BIGSERIAL NOT NULL,
    "from_church" UUID NOT NULL,
    "spent_on" DATE NOT NULL,
    "description" VARCHAR NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expenses_amount_positive_check" CHECK (amount > 0)
);

-- CreateIndex
CREATE INDEX "expenses_church_spent_on_idx"
ON "public"."expenses"("from_church", "spent_on" DESC);

-- CreateIndex
CREATE INDEX "expenses_month_description_idx"
ON "public"."expenses"("from_church", "spent_on", "description");

-- AddForeignKey
ALTER TABLE "public"."expenses"
ADD CONSTRAINT "expenses_from_church_fkey"
FOREIGN KEY ("from_church") REFERENCES "public"."churches"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- Grants for authenticated app access
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."expenses" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE "public"."expenses_id_seq" TO authenticated;

-- RLS setup
ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_select_own_church"
ON "public"."expenses"
FOR SELECT
TO authenticated
USING (from_church = public.get_my_church_id());

CREATE POLICY "expenses_insert_own_church"
ON "public"."expenses"
FOR INSERT
TO authenticated
WITH CHECK (from_church = public.get_my_church_id());

CREATE POLICY "expenses_update_own_church"
ON "public"."expenses"
FOR UPDATE
TO authenticated
USING (from_church = public.get_my_church_id())
WITH CHECK (from_church = public.get_my_church_id());
