-- Additive invite-tracker storage. Existing Grind/Elo tables and rows are untouched.
-- Apply only after the bot runtime has SUPABASE_SECRET_KEY configured.
BEGIN;

CREATE TABLE IF NOT EXISTS public.invite_tracker_config (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    auto_expire_invites BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.invite_tracker_stats (
    guild_id TEXT NOT NULL,
    inviter_id TEXT NOT NULL,
    total_invites INTEGER NOT NULL DEFAULT 0 CHECK (total_invites >= 0),
    left_members INTEGER NOT NULL DEFAULT 0 CHECK (left_members >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (guild_id, inviter_id),
    CHECK (left_members <= total_invites)
);

CREATE TABLE IF NOT EXISTS public.invite_tracker_members (
    guild_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    inviter_id TEXT,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('invite', 'vanity', 'unknown')),
    credited BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ NOT NULL,
    left_at TIMESTAMPTZ,
    PRIMARY KEY (guild_id, member_id)
);

CREATE INDEX IF NOT EXISTS invite_tracker_stats_guild_idx
    ON public.invite_tracker_stats (guild_id);
CREATE INDEX IF NOT EXISTS invite_tracker_members_inviter_idx
    ON public.invite_tracker_members (guild_id, inviter_id);

ALTER TABLE public.invite_tracker_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_tracker_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_tracker_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.invite_tracker_config FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.invite_tracker_stats FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.invite_tracker_members FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.invite_tracker_config TO service_role;
GRANT SELECT ON TABLE public.invite_tracker_stats TO service_role;
GRANT SELECT ON TABLE public.invite_tracker_members TO service_role;

CREATE OR REPLACE FUNCTION public.record_invite_join_atomic(
    p_guild_id TEXT,
    p_member_id TEXT,
    p_inviter_id TEXT,
    p_source_kind TEXT,
    p_joined_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    existing_left_at TIMESTAMPTZ;
    should_credit BOOLEAN;
    stats_total INTEGER := 0;
    stats_left INTEGER := 0;
BEGIN
    IF COALESCE(p_guild_id, '') = '' OR COALESCE(p_member_id, '') = '' THEN
        RAISE EXCEPTION 'Guild and member IDs are required';
    END IF;
    IF p_source_kind IS NULL OR p_source_kind NOT IN ('invite', 'vanity', 'unknown') THEN
        RAISE EXCEPTION 'Invalid invite source kind';
    END IF;
    IF p_joined_at IS NULL THEN
        RAISE EXCEPTION 'Join time is required';
    END IF;

    SELECT left_at
    INTO existing_left_at
    FROM public.invite_tracker_members
    WHERE guild_id = p_guild_id
      AND member_id = p_member_id
    FOR UPDATE;

    IF FOUND AND existing_left_at IS NULL THEN
        RETURN jsonb_build_object('recorded', FALSE);
    END IF;

    should_credit := p_source_kind = 'invite'
        AND p_inviter_id IS NOT NULL
        AND p_inviter_id <> p_member_id;

    INSERT INTO public.invite_tracker_members (
        guild_id,
        member_id,
        inviter_id,
        source_kind,
        credited,
        joined_at,
        left_at
    )
    VALUES (
        p_guild_id,
        p_member_id,
        p_inviter_id,
        p_source_kind,
        should_credit,
        p_joined_at,
        NULL
    )
    ON CONFLICT (guild_id, member_id) DO UPDATE
    SET
        inviter_id = EXCLUDED.inviter_id,
        source_kind = EXCLUDED.source_kind,
        credited = EXCLUDED.credited,
        joined_at = EXCLUDED.joined_at,
        left_at = NULL;

    IF should_credit THEN
        INSERT INTO public.invite_tracker_stats (
            guild_id,
            inviter_id,
            total_invites,
            left_members,
            updated_at
        )
        VALUES (p_guild_id, p_inviter_id, 1, 0, clock_timestamp())
        ON CONFLICT (guild_id, inviter_id) DO UPDATE
        SET
            total_invites = invite_tracker_stats.total_invites + 1,
            updated_at = clock_timestamp()
        RETURNING total_invites, left_members
        INTO stats_total, stats_left;
    END IF;

    RETURN jsonb_build_object(
        'recorded', TRUE,
        'credited', should_credit,
        'guild_id', p_guild_id,
        'member_id', p_member_id,
        'inviter_id', p_inviter_id,
        'source_kind', p_source_kind,
        'total_invites', stats_total,
        'left_members', stats_left,
        'net_invites', stats_total - stats_left
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invite_leave_atomic(
    p_guild_id TEXT,
    p_member_id TEXT,
    p_left_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    member_inviter_id TEXT;
    member_source_kind TEXT;
    member_credited BOOLEAN;
    existing_left_at TIMESTAMPTZ;
    stats_total INTEGER := 0;
    stats_left INTEGER := 0;
BEGIN
    IF COALESCE(p_guild_id, '') = '' OR COALESCE(p_member_id, '') = '' THEN
        RAISE EXCEPTION 'Guild and member IDs are required';
    END IF;
    IF p_left_at IS NULL THEN
        RAISE EXCEPTION 'Leave time is required';
    END IF;

    SELECT inviter_id, source_kind, credited, left_at
    INTO member_inviter_id, member_source_kind, member_credited, existing_left_at
    FROM public.invite_tracker_members
    WHERE guild_id = p_guild_id
      AND member_id = p_member_id
    FOR UPDATE;

    IF NOT FOUND OR existing_left_at IS NOT NULL THEN
        RETURN jsonb_build_object('recorded', FALSE);
    END IF;

    UPDATE public.invite_tracker_members
    SET left_at = p_left_at
    WHERE guild_id = p_guild_id
      AND member_id = p_member_id;

    IF member_credited THEN
        UPDATE public.invite_tracker_stats
        SET
            left_members = left_members + 1,
            updated_at = clock_timestamp()
        WHERE guild_id = p_guild_id
          AND inviter_id = member_inviter_id
        RETURNING total_invites, left_members
        INTO stats_total, stats_left;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invite statistics are missing for inviter %', member_inviter_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'recorded', TRUE,
        'credited', member_credited,
        'guild_id', p_guild_id,
        'member_id', p_member_id,
        'inviter_id', member_inviter_id,
        'source_kind', member_source_kind,
        'total_invites', stats_total,
        'left_members', stats_left,
        'net_invites', stats_total - stats_left
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_invite_join_atomic(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_invite_leave_atomic(TEXT, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invite_join_atomic(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.record_invite_leave_atomic(TEXT, TEXT, TIMESTAMPTZ)
    TO service_role;

COMMIT;
