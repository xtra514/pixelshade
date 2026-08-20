async function test() {
    const { createClient } = require('@supabase/supabase-js');
    require('dotenv').config();

    const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
    const brawlToken = process.env.BRAWL_STARS_TOKEN || process.env.BRAWL_API_TOKEN;
    if (!process.env.SUPABASE_URL || !supabaseKey || !brawlToken) {
        throw new Error('Supabase and Brawl Stars credentials are required');
    }

    const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);
    const { data: members, error } = await supabase.from('club_members').select('*');
    if (error) throw new Error(`Could not read club members: ${error.message}`);

    for (const member of members) {
        const tag = member.tag.replace('#', '%23');
        let res;
        try {
            res = await fetch(`https://bsproxy.royaleapi.dev/v1/players/${tag}/battlelog`, {
                headers: { 'Authorization': `Bearer ${brawlToken}`, 'Accept': 'application/json' }
            });
        } catch (e) { continue; }
        if (!res.ok) continue;
        const logData = await res.json();
        const logs = logData.items;
        if (!logs) continue;

        for (const log of logs) {
            if (log.battleTime >= '20260627T145000.000Z') {
                let b = null;
                if (log.battle.teams) {
                    for (const team of log.battle.teams) for (const p of team) if (p.tag === member.tag) b = p.brawler;
                } else if (log.battle.players) {
                    for (const p of log.battle.players) if (p.tag === member.tag) b = p.brawler;
                }
                if (!b) continue;
                console.log(`${member.tag} - ${log.battleTime} | ${b.name} (${b.trophies}) | ${log.battle.mode} | ${log.battle.result || log.battle.rank} | diff: ${log.battle.trophyChange}`);
            }
        }
    }
}
test().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});

