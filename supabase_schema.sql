-- Create global_state table
CREATE TABLE global_state (
  id INT PRIMARY KEY,
  is_grind_tracking BOOLEAN DEFAULT false,
  is_elo_tracking BOOLEAN DEFAULT false,
  start_time TIMESTAMP WITH TIME ZONE
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
  last_battle_time TEXT,
  brawlers JSONB DEFAULT '[]'::jsonb
);

-- Turn off Row Level Security so our Bot/Worker can read and write freely without complex auth rules
ALTER TABLE global_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE club_members DISABLE ROW LEVEL SECURITY;
