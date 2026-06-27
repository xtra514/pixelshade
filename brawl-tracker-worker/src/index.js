import { createClient } from '@supabase/supabase-js';

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(processBattlelogs(env));
    }
};

async function processBattlelogs(env) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

    // 1. Check if tracking is active
    const { data: state } = await supabase.from('global_state').select('is_grind_tracking').eq('id', 1).single();
    if (!state || !state.is_grind_tracking) return;

    // 2. Get all tracked members
    const { data: members, error } = await supabase.from('club_members').select('*');
    if (error || !members) return;

    for (const member of members) {
        try {
            const formattedTag = member.tag.replace('#', '%23');
            const res = await fetch(`https://bsproxy.royaleapi.dev/v1/players/${formattedTag}/battlelog`, {
                headers: {
                    'Authorization': `Bearer ${env.BRAWL_API_TOKEN}`,
                    'Accept': 'application/json'
                }
            });

            if (!res.ok) continue;
            const logData = await res.json();
            const logs = logData.items;
            if (!logs || logs.length === 0) continue;

            const sortedLogs = logs
                .filter(l => l.battleTime)
                .sort((a, b) => a.battleTime.localeCompare(b.battleTime));

            let newLastTime = member.last_battle_time || '';
            let brawlers = member.brawlers || [];
            
            // Extract persistent state across cron runs
            let stateObj = brawlers.find(b => b.id === -1);
            if (!stateObj) {
                stateObj = { 
                    id: -1, 
                    lossCount: 0, 
                    exploitArmed: false
                };
                brawlers.push(stateObj);
            }
            
            let lossCount = stateObj.lossCount || 0;
            let exploitArmed = stateObj.exploitArmed || false;
            let dirty = false;

            let startIndex = sortedLogs.findIndex(log => log.battleTime === member.last_battle_time);
            let logsToProcess = [];
            
            if (!member.last_battle_time || member.last_battle_time === '20000101T000000.000Z') {
                console.log(`[${member.tag}] First time tracking. Skipping historical matches.`);
                logsToProcess = []; // Just update last_battle_time, skip checking exploits
            } else if (startIndex === -1) {
                // If last_battle_time not found, process all (might be very old)
                logsToProcess = sortedLogs;
            } else {
                logsToProcess = sortedLogs.slice(startIndex + 1);
            }

            for (const log of logsToProcess) {
                if (member.last_battle_time && log.battleTime <= member.last_battle_time) continue;
                
                // Find my brawler
                let myBrawler = null;
                if (log.battle.teams) {
                    for (const team of log.battle.teams) {
                        for (const p of team) {
                            if (p.tag === member.tag) myBrawler = p.brawler;
                        }
                    }
                } else if (log.battle.players) {
                    for (const p of log.battle.players) {
                        if (p.tag === member.tag) myBrawler = p.brawler;
                    }
                }

                if (!myBrawler) continue;

                if (log.battle.type !== 'ranked') {
                    console.log(`[${member.tag}] Skipping non-trophy match (type: ${log.battle.type})`);
                    continue;
                }

                const isLoss = (log.battle.result === 'defeat' || (log.battle.trophyChange !== undefined && log.battle.trophyChange < 0));
                const isWin = (log.battle.result === 'victory' || (log.battle.trophyChange !== undefined && log.battle.trophyChange > 0));

                if (isLoss) {
                    console.log(`[${member.tag}] Defeat with brawler ${myBrawler.id} (${myBrawler.name}) - ${myBrawler.trophies} Trophies.`);
                    if (myBrawler.trophies <= 1000) {
                        lossCount++;
                        if (lossCount >= 2) {
                            exploitArmed = true;
                            console.log(`[${member.tag}] 🚨 Trap armed! 2+ losses reached. Next win <= 1999 will be flagged as a bot match exploit.`);
                        } else {
                            console.log(`[${member.tag}] 📉 Loss count is now ${lossCount}.`);
                        }
                    } else if (myBrawler.trophies % 1000 === 0) {
                        console.log(`[${member.tag}] ⏸️ Loss on Prestige Floor (${myBrawler.trophies}). Streak preserved but not incremented.`);
                    } else {
                        lossCount = 0;
                        exploitArmed = false;
                        console.log(`[${member.tag}] ❌ Trophies > 1000 and not on floor. Resetting all exploit state.`);
                    }
                } else if (isWin) {
                    console.log(`[${member.tag}] Victory with brawler ${myBrawler.id} (${myBrawler.name}) - ${myBrawler.trophies} Trophies.`);
                    if (exploitArmed && myBrawler.trophies <= 1999) {
                        const gained = (log.battle.trophyChange && log.battle.trophyChange > 0) ? log.battle.trophyChange : 8;
                        
                        let bIndex = brawlers.findIndex(b => b.id === myBrawler.id);
                        if (bIndex !== -1) {
                            brawlers[bIndex].illegitimate = (brawlers[bIndex].illegitimate || 0) + gained;
                        } else {
                            brawlers.push({
                                id: myBrawler.id,
                                name: myBrawler.name,
                                trophies: myBrawler.trophies,
                                illegitimate: gained
                            });
                        }
                        dirty = true;
                        console.log(`[${member.tag}] 🚨 BOT EXPLOIT CAUGHT! Stripped ${gained} Grind Points from ${myBrawler.name}.`);
                        
                        // Send Alert to Discord
                        if (env.DISCORD_TOKEN && env.ILLUMINATI_CHANNEL_ID) {
                            const alertMsg = `🚨 **BOT EXPLOIT DETECTED** 🚨\nPlayer **${member.name}** (\`${member.tag}\`) was caught attempting to farm bot matches using \`${myBrawler.name}\`!\n💥 **Stripped ${gained} Grind Points** from their score!`;
                            try {
                                await fetch(`https://discord.com/api/v10/channels/${env.ILLUMINATI_CHANNEL_ID}/messages`, {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bot ${env.DISCORD_TOKEN}`,
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ content: alertMsg })
                                });
                            } catch (e) {
                                console.error('Failed to send Discord alert:', e);
                            }
                        }
                        
                    } else {
                        console.log(`[${member.tag}] 🛑 Win streak cleared (Normal win).`);
                    }
                    
                    // Reset all state on any win
                    lossCount = 0;
                    exploitArmed = false;
                }
            }

            // Always update newLastTime to the absolute newest log
            if (sortedLogs.length > 0) {
                newLastTime = sortedLogs[sortedLogs.length - 1].battleTime;
            }

            if (newLastTime !== member.last_battle_time || dirty) {
                stateObj.lossCount = lossCount;
                stateObj.exploitArmed = exploitArmed;
                
                const updates = { 
                    last_battle_time: newLastTime,
                    brawlers: brawlers
                };
                await supabase.from('club_members').update(updates).eq('tag', member.tag);
            }

        } catch (e) {
            console.error(`Error processing ${member.tag}: ${e.message}`);
        }
    }
}
