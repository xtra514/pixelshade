-- Create global_state table
CREATE TABLE global_state (
  id INT PRIMARY KEY,
  is_grind_tracking BOOLEAN DEFAULT false,
  is_elo_tracking BOOLEAN DEFAULT false,
  start_time TIMESTAMP WITH TIME ZONE,
  grind_worker_lock_owner TEXT,
  grind_worker_lock_until TIMESTAMP WITH TIME ZONE
);

-- Insert the default row (ID 1)
INSERT INTO global_state (id, is_grind_tracking, is_elo_tracking) VALUES (1, false, false);

-- Create club_members table
CREATE TABLE club_members (
  tag TEXT PRIMARY KEY,
  name TEXT,
  baseline_trophies INT DEFAULT 0,
  current_elo INT,
  current_skill INT,
  -- Legacy shared cursor retained for rollback compatibility.
  last_battle_time TEXT,
  last_grind_battle_time TEXT,
  last_elo_battle_time TEXT,
  brawlers JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE invite_tracker_config (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  auto_expire_invites BOOLEAN NOT NULL DEFAULT false,
  updated_by TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE invite_tracker_stats (
  guild_id TEXT NOT NULL,
  inviter_id TEXT NOT NULL,
  total_invites INT NOT NULL DEFAULT 0 CHECK (total_invites >= 0),
  left_members INT NOT NULL DEFAULT 0 CHECK (left_members >= 0),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, inviter_id),
  CHECK (left_members <= total_invites)
);

CREATE TABLE invite_tracker_members (
  guild_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  inviter_id TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('invite', 'vanity', 'unknown')),
  credited BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL,
  left_at TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (guild_id, member_id)
);

-- Backend services must use SUPABASE_SECRET_KEY. Publishable/anon clients receive no table access.
ALTER TABLE global_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_tracker_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_tracker_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_tracker_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE global_state FROM anon, authenticated;
REVOKE ALL ON TABLE club_members FROM anon, authenticated;
REVOKE ALL ON TABLE invite_tracker_config FROM anon, authenticated;
REVOKE ALL ON TABLE invite_tracker_stats FROM anon, authenticated;
REVOKE ALL ON TABLE invite_tracker_members FROM anon, authenticated;
REVOKE ALL ON TABLE global_state FROM service_role;
REVOKE ALL ON TABLE club_members FROM service_role;
REVOKE ALL ON TABLE invite_tracker_config FROM service_role;
REVOKE ALL ON TABLE invite_tracker_stats FROM service_role;
REVOKE ALL ON TABLE invite_tracker_members FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE global_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE club_members TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE invite_tracker_config TO service_role;
GRANT SELECT ON TABLE invite_tracker_stats TO service_role;
GRANT SELECT ON TABLE invite_tracker_members TO service_role;
