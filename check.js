require('dotenv').config();
const brawlAPI = require('./brawlAPI');
const fs = require('fs');

async function check() {
    console.log("Fetching current club members...");
    try {
        const members = await brawlAPI.getClubMembers(process.env.CLUB_TAG);
        const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

        console.log("Changes since baseline:");
        let anyChanges = false;

        for (const baseline of data.members) {
            const currentMember = members.find(m => m.tag === baseline.tag);
            if (currentMember) {
                const gained = currentMember.trophies - baseline.baselineTrophies;
                if (gained !== 0) {
                    console.log(`- ${baseline.name}: gained ${gained} (Now: ${currentMember.trophies}, Was: ${baseline.baselineTrophies})`);
                    anyChanges = true;
                }
            }
        }

        if (!anyChanges) {
            console.log("No trophy changes detected from the official Brawl Stars API.");
        }

    } catch (e) {
        console.error('Failed:', e.message);
    }
}

check();
