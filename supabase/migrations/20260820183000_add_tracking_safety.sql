-- Additive, data-preserving migration. This file does not delete rows or legacy columns.
BEGIN;

ALTER TABLE public.club_members
    ADD COLUMN IF NOT EXISTS last_grind_battle_time TEXT,
    ADD COLUMN IF NOT EXISTS last_elo_battle_time TEXT;

UPDATE public.club_members
SET
    last_grind_battle_time = COALESCE(last_grind_battle_time, last_battle_time),
    last_elo_battle_time = COALESCE(last_elo_battle_time, last_battle_time)
WHERE last_grind_battle_time IS NULL
   OR last_elo_battle_time IS NULL;

ALTER TABLE public.global_state
    ADD COLUMN IF NOT EXISTS grind_worker_lock_owner TEXT,
    ADD COLUMN IF NOT EXISTS grind_worker_lock_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.acquire_grind_worker_lease(
    p_owner TEXT,
    p_lease_seconds INTEGER DEFAULT 110
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF p_owner IS NULL OR p_owner = '' THEN
        RAISE EXCEPTION 'Lease owner is required';
    END IF;

    UPDATE public.global_state
    SET
        grind_worker_lock_owner = p_owner,
        grind_worker_lock_until = clock_timestamp()
            + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 110), 10), 300))
    WHERE id = 1
      AND (
          grind_worker_lock_until IS NULL
          OR grind_worker_lock_until < clock_timestamp()
          OR grind_worker_lock_owner = p_owner
      );

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_grind_worker_lease(p_owner TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    UPDATE public.global_state
    SET
        grind_worker_lock_owner = NULL,
        grind_worker_lock_until = NULL
    WHERE id = 1
      AND grind_worker_lock_owner = p_owner;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_grind_atomic(p_tag TEXT, p_amount INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    current_brawlers JSONB;
    state_index INTEGER;
    new_adjustment INTEGER;
BEGIN
    IF p_amount IS NULL THEN
        RAISE EXCEPTION 'Adjustment amount is required';
    END IF;

    SELECT COALESCE(brawlers, '[]'::JSONB)
    INTO current_brawlers
    FROM public.club_members
    WHERE tag = p_tag
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tracked member % does not exist', p_tag;
    END IF;

    SELECT element.ordinality::INTEGER - 1
    INTO state_index
    FROM jsonb_array_elements(current_brawlers) WITH ORDINALITY AS element(value, ordinality)
    WHERE element.value ->> 'id' = '-1'
    LIMIT 1;

    IF state_index IS NULL THEN
        new_adjustment := p_amount;
        current_brawlers := current_brawlers || jsonb_build_array(
            jsonb_build_object(
                'id', -1,
                'lossCount', 0,
                'exploitArmed', FALSE,
                'grindAdjustment', new_adjustment
            )
        );
    ELSE
        new_adjustment := COALESCE(
            (current_brawlers -> state_index ->> 'grindAdjustment')::INTEGER,
            0
        ) + p_amount;
        current_brawlers := jsonb_set(
            current_brawlers,
            ARRAY[state_index::TEXT, 'grindAdjustment'],
            to_jsonb(new_adjustment),
            TRUE
        );
    END IF;

    UPDATE public.club_members
    SET brawlers = current_brawlers
    WHERE tag = p_tag;

    RETURN new_adjustment;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_grind_member_state_atomic(
    p_tag TEXT,
    p_expected_cursor TEXT,
    p_new_cursor TEXT,
    p_brawlers JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    current_brawlers JSONB;
    current_cursor TEXT;
    current_state JSONB;
    incoming_state JSONB;
    incoming_state_index INTEGER;
    merged_state JSONB;
    new_brawlers JSONB;
BEGIN
    IF jsonb_typeof(p_brawlers) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'p_brawlers must be a JSON array';
    END IF;
    IF COALESCE(p_new_cursor, '') = '' THEN
        RAISE EXCEPTION 'p_new_cursor is required';
    END IF;

    SELECT
        COALESCE(brawlers, '[]'::JSONB),
        COALESCE(last_grind_battle_time, '')
    INTO current_brawlers, current_cursor
    FROM public.club_members
    WHERE tag = p_tag
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tracked member % does not exist', p_tag;
    END IF;

    IF current_cursor IS DISTINCT FROM COALESCE(p_expected_cursor, '') THEN
        RETURN FALSE;
    END IF;

    SELECT element.value
    INTO current_state
    FROM jsonb_array_elements(current_brawlers) AS element(value)
    WHERE element.value ->> 'id' = '-1'
    LIMIT 1;

    SELECT element.value, element.ordinality::INTEGER - 1
    INTO incoming_state, incoming_state_index
    FROM jsonb_array_elements(p_brawlers) WITH ORDINALITY AS element(value, ordinality)
    WHERE element.value ->> 'id' = '-1'
    LIMIT 1;

    IF incoming_state_index IS NULL THEN
        RAISE EXCEPTION 'p_brawlers must include the Grind state sentinel';
    END IF;

    merged_state := COALESCE(incoming_state, '{}'::JSONB)
        || COALESCE(current_state, '{}'::JSONB)
        || jsonb_build_object(
            'id', -1,
            'lossCount', COALESCE((incoming_state ->> 'lossCount')::INTEGER, 0),
            'exploitArmed', COALESCE((incoming_state ->> 'exploitArmed')::BOOLEAN, FALSE)
        );
    new_brawlers := jsonb_set(
        p_brawlers,
        ARRAY[incoming_state_index::TEXT],
        merged_state,
        FALSE
    );

    UPDATE public.club_members
    SET
        brawlers = new_brawlers,
        last_grind_battle_time = p_new_cursor
    WHERE tag = p_tag;

    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_grind_member_atomic(p_member JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF jsonb_typeof(p_member) IS DISTINCT FROM 'object'
       OR COALESCE(p_member ->> 'tag', '') = '' THEN
        RAISE EXCEPTION 'p_member must be an object with a tag';
    END IF;

    INSERT INTO public.club_members (
        tag,
        name,
        baseline_trophies,
        brawlers,
        last_grind_battle_time
    )
    VALUES (
        p_member ->> 'tag',
        p_member ->> 'name',
        (p_member ->> 'baseline_trophies')::INTEGER,
        COALESCE(p_member -> 'brawlers', '[]'::JSONB),
        NULL
    )
    ON CONFLICT (tag) DO UPDATE
    SET
        name = EXCLUDED.name,
        baseline_trophies = EXCLUDED.baseline_trophies,
        brawlers = EXCLUDED.brawlers,
        last_grind_battle_time = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_tracking_atomic(
    p_started_at TIMESTAMPTZ,
    p_members JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF jsonb_typeof(p_members) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_members) = 0 THEN
        RAISE EXCEPTION 'p_members must be a non-empty JSON array';
    END IF;

    INSERT INTO public.club_members (
        tag,
        name,
        baseline_trophies,
        brawlers,
        last_grind_battle_time
    )
    SELECT
        member ->> 'tag',
        member ->> 'name',
        (member ->> 'baseline_trophies')::INTEGER,
        COALESCE(member -> 'brawlers', '[]'::JSONB),
        NULL::TEXT
    FROM jsonb_array_elements(p_members) AS item(member)
    ON CONFLICT (tag) DO UPDATE
    SET
        name = EXCLUDED.name,
        baseline_trophies = EXCLUDED.baseline_trophies,
        brawlers = EXCLUDED.brawlers,
        last_grind_battle_time = NULL;

    UPDATE public.global_state
    SET
        is_grind_tracking = TRUE,
        start_time = p_started_at
    WHERE id = 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'global_state row 1 does not exist';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_grind_worker_lease(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_grind_worker_lease(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_grind_atomic(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_grind_member_state_atomic(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_grind_member_atomic(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_tracking_atomic(TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_grind_worker_lease(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_grind_worker_lease(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_grind_atomic(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_grind_member_state_atomic(TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_grind_member_atomic(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_tracking_atomic(TIMESTAMPTZ, JSONB) TO service_role;

COMMIT;
