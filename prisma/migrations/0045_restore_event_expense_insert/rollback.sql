-- Restore the 0039 Finance-only policy.

BEGIN;

DROP POLICY IF EXISTS expenses_insert_own_church ON public.expenses;
CREATE POLICY expenses_insert_own_church ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_finance() AND public.can_write_church(from_church)
    AND kind = 'entry' AND corrects_id IS NULL AND reason IS NULL
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
