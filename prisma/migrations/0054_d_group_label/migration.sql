-- 0054_d_group_label — Small Groups are now called Discipleship Groups (D-Groups).
-- 0052's archive_retained_assignments() hands the Archived members screen the
-- word "Small group" as an assignment's kind, so the label changes here.
--
-- Label only. The tables, columns and functions keep their small_group names:
-- users never see them, and renaming them would rewrite the RLS policies.
-- Same signature as 0052, so the REVOKE carries over.

BEGIN;

CREATE OR REPLACE FUNCTION public.archive_retained_assignments(p_member_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', k, 'label', label, 'kind', kind) ORDER BY k), '[]'::jsonb)
  FROM (
    SELECT 'role:' || ua.role AS k, initcap(replace(ua.role, '_', ' ')) AS label, 'Role' AS kind
    FROM public.user_accounts ua WHERE ua.member_id = p_member_id
    UNION ALL
    SELECT 'ministry:' || mi.id::text, mi.name, 'Ministry'
    FROM public.ministry_members mm JOIN public.ministries mi ON mi.id = mm.ministry_id WHERE mm.member_id = p_member_id
    UNION ALL
    SELECT 'group:' || sg.id::text, sg.name, 'D-Group'
    FROM public.small_group_members sm JOIN public.small_groups sg ON sg.id = sm.small_group_id WHERE sm.member_id = p_member_id
    UNION ALL
    SELECT 'leader:' || sg.id::text, 'Leader of ' || sg.name, 'Leadership'
    FROM public.small_group_leaders sl JOIN public.small_groups sg ON sg.id = sl.group_id
    JOIN public.user_accounts ua ON ua.id = sl.account_id WHERE ua.member_id = p_member_id
  ) a
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
