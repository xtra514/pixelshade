import dotenv from 'dotenv';
dotenv.config();

const API_URL = 'https://bsproxy.royaleapi.dev/v1';

async function checkTags() {
    const tags = ['#99VGJCGJU', '#YG9UR2C8V', '#892GQ2YY9', '#PUP09U9Q', '#LY2LL9L'];
    
    for (const tag of tags) {
        const cleanTag = tag.replace('#', '%23');
        try {
            const res = await fetch(`${API_URL}/players/${cleanTag}/battlelog`, {
                headers: { 'Authorization': `Bearer ${process.env.BRAWL_API_TOKEN}` }
            });
            const data = await res.json();
            if (!data.items) {
                console.log(`No items for ${tag}`, data);
                continue;
            }
            console.log(`\n=== TAG: ${tag} ===`);
            // Check the first 5 matches
            for (let i = 0; i < Math.min(5, data.items.length); i++) {
                const log = data.items[i];
                let myBrawler = null;
                // find brawler in teams or players
                if (log.battle.teams) {
                    for (const team of log.battle.teams) {
                        const me = team.find(p => p.tag === tag);
                        if (me) myBrawler = me.brawler;
                    }
                } else if (log.battle.players) {
                    const me = log.battle.players.find(p => p.tag === tag);
                    if (me) myBrawler = me.brawler;
                }
                const isWin = (log.battle.result === 'victory' || (log.battle.rank && log.battle.rank <= 4));
                const isLoss = (log.battle.result === 'defeat' || (log.battle.rank && log.battle.rank > 4));
                console.log(`${log.battleTime} - ${myBrawler ? myBrawler.name : 'Unknown'} - ${isWin ? 'WIN' : (isLoss ? 'LOSS' : 'DRAW')} - Trophies: ${myBrawler ? myBrawler.trophies : '?'}`);
            }
        } catch (e) {
            console.error(e);
        }
    }
}
checkTags();
