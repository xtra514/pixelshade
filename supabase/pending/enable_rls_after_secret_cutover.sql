-- DO NOT APPLY while the bot or Worker uses SUPABASE_KEY with a publishable/anon key.
-- First configure SUPABASE_SECRET_KEY in both runtimes and verify read/write operations.
BEGIN;

ALTER TABLE public.global_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_tracker_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_tracker_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_tracker_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.global_state FROM anon, authenticated;
REVOKE ALL ON TABLE public.club_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.invite_tracker_config FROM anon, authenticated;
REVOKE ALL ON TABLE public.invite_tracker_stats FROM anon, authenticated;
REVOKE ALL ON TABLE public.invite_tracker_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.global_state FROM service_role;
REVOKE ALL ON TABLE public.club_members FROM service_role;
REVOKE ALL ON TABLE public.invite_tracker_config FROM service_role;
REVOKE ALL ON TABLE public.invite_tracker_stats FROM service_role;
REVOKE ALL ON TABLE public.invite_tracker_members FROM service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.global_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.club_members TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.invite_tracker_config TO service_role;
GRANT SELECT ON TABLE public.invite_tracker_stats TO service_role;
GRANT SELECT ON TABLE public.invite_tracker_members TO service_role;

COMMIT;
