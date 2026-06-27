const fs = require('fs');

async function test() {
    require('dotenv').config({ path: 'D:/Projects/PixelShade/brawl-tracker-worker/.dev.vars' });

    const tag = '%2399VGJCGJU'; // #99VGJCGJU
    const res = await fetch(`https://bsproxy.royaleapi.dev/v1/players/${tag}/battlelog`, {
        headers: {
            'Authorization': `Bearer ${process.env.BRAWL_API_TOKEN}`,
            'Accept': 'application/json'
        }
    });
    
    if (!res.ok) {
        console.error("Failed to fetch", res.status);
        return;
    }
    const logData = await res.json();
    const logs = logData.items;

    const sortedLogs = logs
        .filter(l => l.battleTime)
        .sort((a, b) => a.battleTime.localeCompare(b.battleTime));

    let lossCount = 0;
    let exploitArmed = false;

    console.log(`Processing ${sortedLogs.length} matches...`);

    for (const log of sortedLogs) {
        let myBrawler = null;
        if (log.battle.teams) {
            for (const team of log.battle.teams) {
                for (const p of team) {
                    if (p.tag === '#99VGJCGJU') myBrawler = p.brawler;
                }
            }
        } else if (log.battle.players) {
            for (const p of log.battle.players) {
                if (p.tag === '#99VGJCGJU') myBrawler = p.brawler;
            }
        }

        if (!myBrawler) continue;

        if (log.battle.type !== 'ranked') {
            console.log(`Skipping non-trophy match (type: ${log.battle.type})`);
            continue;
        }

        let isLoss = (log.battle.result === 'defeat' || (log.battle.trophyChange !== undefined && log.battle.trophyChange < 0));
        let isWin = (log.battle.result === 'victory' || (log.battle.trophyChange !== undefined && log.battle.trophyChange > 0));

        if (log.battle.rank !== undefined) {
            if (log.battle.mode === 'soloShowdown') {
                if (log.battle.rank > 5) isLoss = true;
                else if (log.battle.rank < 5) isWin = true;
            } else if (log.battle.mode === 'duoShowdown') {
                if (log.battle.rank > 3) isLoss = true;
                else if (log.battle.rank < 3) isWin = true;
            }
        }

        console.log(`\nMatch at ${log.battleTime} | Brawler: ${myBrawler.name} | Trophies: ${myBrawler.trophies} | Result: ${log.battle.result} | TrophyChange: ${log.battle.trophyChange} | Mode: ${log.battle.mode} | Rank: ${log.battle.rank}`);
        
        if (isLoss) {
            console.log(`Defeat with brawler ${myBrawler.id} (${myBrawler.name}) - ${myBrawler.trophies} Trophies.`);
            if (myBrawler.trophies <= 1000) {
                lossCount++;
                if (lossCount >= 2) {
                    exploitArmed = true;
                    console.log(`🚨 Trap armed! 2+ losses reached.`);
                } else {
                    console.log(`📉 Loss count is now ${lossCount}.`);
                }
            } else if (myBrawler.trophies % 1000 === 0) {
                console.log(`⏸️ Loss on Prestige Floor (${myBrawler.trophies}). Streak preserved.`);
            } else {
                lossCount = 0;
                exploitArmed = false;
                console.log(`❌ Trophies > 1000 and not on floor. Resetting all exploit state.`);
            }
        } else if (isWin) {
            console.log(`Victory with brawler ${myBrawler.id} (${myBrawler.name}) - ${myBrawler.trophies} Trophies.`);
            if (exploitArmed && myBrawler.trophies <= 1999) {
                console.log(`🚨 BOT EXPLOIT CAUGHT!`);
            } else {
                console.log(`🛑 Win streak cleared (Normal win).`);
            }
            lossCount = 0;
            exploitArmed = false;
        } else {
            console.log("NEITHER WIN NOR LOSS? isLoss=", isLoss, "isWin=", isWin);
        }
    }
}
test();
