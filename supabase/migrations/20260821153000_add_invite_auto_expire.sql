-- Additive per-server toggle for deleting a used Discord invite.
-- Existing invite, Grind, and Elo rows are untouched.
BEGIN;

ALTER TABLE public.invite_tracker_config
    ADD COLUMN IF NOT EXISTS auto_expire_invites BOOLEAN NOT NULL DEFAULT FALSE;

-- Backend-only read access is required for complete verified backups.
GRANT SELECT ON TABLE public.invite_tracker_members TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
