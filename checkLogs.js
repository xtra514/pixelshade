const fs = require('fs');
async function test() {
    const { createClient } = require('@supabase/supabase-js');
    require('dotenv').config({ path: 'D:/Projects/PixelShade/brawl-tracker-worker/.dev.vars' });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { data: members } = await supabase.from('club_members').select('*');
    if (!members) return;

    for (const member of members) {
        const tag = member.tag.replace('#', '%23');
        let res;
        try {
            res = await fetch(`https://bsproxy.royaleapi.dev/v1/players/${tag}/battlelog`, {
                headers: { 'Authorization': `Bearer ${process.env.BRAWL_API_TOKEN}`, 'Accept': 'application/json' }
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
test();

