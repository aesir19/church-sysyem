-- 0045_restore_event_expense_insert — restore the Events Team branch removed by 0039.
--
-- 0035 allowed Finance users to add ordinary expenses and Events Team members to add
-- ordinary expenses linked to events they manage. 0039 rebuilt this policy for append-only
-- corrections but accidentally kept only the Finance branch. Keep the 0039 integrity rules
-- outside both branches so neither role can insert a reversal or forge a correction link.

BEGIN;

DROP POLICY IF EXISTS expenses_insert_own_church ON public.expenses;
CREATE POLICY expenses_insert_own_church ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      (public.can_write_finance() AND public.can_write_church(from_church))
      OR
      (public.is_own_event_expense(event_id) AND public.can_write_church(from_church))
    )
    AND kind = 'entry'
    AND corrects_id IS NULL
    AND reason IS NULL
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
