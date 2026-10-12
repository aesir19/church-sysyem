-- 0053_awaiting_access_restore_details — the Awaiting access list shows when and
-- why each member was restored (docs/specs/archived-members.md, "Show the
-- restoration reason/date"). 0052 returned neither, so each row could only say
-- "Restored". The list now carries the latest restore event, newest first, and
-- the search box also matches the restore reason there.
--
-- Same signature as 0052, so grants carry over. Archived-tab rows skip the lookup.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_archived_members(p_church_id uuid, p_query text DEFAULT '', p_page integer DEFAULT 1, p_awaiting boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE rows jsonb; total bigint; archived_count bigint; awaiting_count bigint;
BEGIN
  PERFORM public.check_archive_access();
  IF p_church_id IS NULL OR NOT public.can_see_member_detail() OR NOT public.can_read_church(p_church_id)
    OR (p_awaiting AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > 100000 OR length(p_query) > 200 THEN
    RAISE EXCEPTION 'invalid search' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO archived_count FROM public.members WHERE member_of = p_church_id AND archived_at IS NOT NULL;
  IF public.is_super_admin() THEN
    SELECT count(*) INTO awaiting_count FROM public.members m JOIN public.user_accounts a ON a.member_id = m.id
      WHERE m.member_of = p_church_id AND m.archived_at IS NULL AND a.archive_disabled_at IS NOT NULL;
  END IF;
  WITH matching AS (
    SELECT m.id, m.first_name, m.last_name, m.middle_name, m.archived_at, m.archived_reason,
      a.id AS account_id, a.archive_disabled_at AS disabled_at,
      r.occurred_at AS restored_at, r.reason AS restored_reason
    FROM public.members m LEFT JOIN public.user_accounts a ON a.member_id = m.id
    LEFT JOIN LATERAL (
      SELECT e.occurred_at, e.reason FROM public.member_archive_events e
      WHERE p_awaiting AND e.member_id = m.id AND e.action = 'restore'
      ORDER BY e.occurred_at DESC LIMIT 1
    ) r ON true
    WHERE m.member_of = p_church_id
      AND CASE WHEN p_awaiting THEN m.archived_at IS NULL AND a.archive_disabled_at IS NOT NULL ELSE m.archived_at IS NOT NULL END
      AND (coalesce(p_query, '') = '' OR strpos(lower(concat_ws(' ', m.first_name, m.middle_name, m.last_name, m.id::text, m.archived_reason, r.reason)), lower(btrim(p_query))) > 0)
  ), page AS (
    SELECT * FROM matching ORDER BY coalesce(archived_at, restored_at) DESC NULLS LAST, last_name, first_name, id LIMIT 25 OFFSET ((p_page - 1) * 25)
  )
  SELECT (SELECT count(*) FROM matching), coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page), '[]') INTO total, rows;
  RETURN jsonb_build_object('rows', rows, 'total', total, 'archived_count', archived_count, 'awaiting_count', awaiting_count);
END
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
