require('dotenv').config();
const brawlAPI = require('./brawlAPI');

async function testAPI() {
    const clubTag = process.env.CLUB_TAG;
    if (!clubTag) {
        console.error("No CLUB_TAG in .env");
        return;
    }

    console.log(`Fetching club: ${clubTag}`);
    try {
        const members = await brawlAPI.getClubMembers(clubTag);
        console.log(`Successfully fetched ${members.length} members.`);

        if (members.length > 0) {
            const firstMember = members[0];
            console.log(`\nFetching full profile for member 1: ${firstMember.name} (${firstMember.tag})`);

            const profile = await brawlAPI.getPlayer(firstMember.tag);
            if (profile) {
                console.log(`Name: ${profile.name}`);
                console.log(`Total Trophies: ${profile.trophies}`);
                console.log(`Brawlers unlocked: ${profile.brawlers ? profile.brawlers.length : 0}`);
                if (profile.brawlers && profile.brawlers.length > 0) {
                    console.log(`Sample Brawler: ${profile.brawlers[0].name} (Trophies: ${profile.brawlers[0].trophies})`);
                }
                console.log("\n✅ API IS WORKING PERFECTLY!");
            } else {
                console.log("❌ Failed to fetch player profile.");
            }
        }
    } catch (err) {
        console.error("❌ API Test error:", err.message);
    }
}

testAPI();
