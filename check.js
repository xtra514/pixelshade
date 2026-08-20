require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
if (!process.env.SUPABASE_URL || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_KEY) are required');
}

const supabase = createClient(process.env.SUPABASE_URL, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function check() {
    const { data, error } = await supabase
        .from('club_members')
        .select('*');
    if (error) throw new Error(`Could not read club members: ${error.message}`);
    console.table(data.map((member) => ({
        tag: member.tag,
        name: member.name,
        lastBattleTime: member.last_battle_time,
        lastGrindBattleTime: member.last_grind_battle_time || null,
        lastEloBattleTime: member.last_elo_battle_time || null
    })));
}

check().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
