require('dotenv').config();
const brawlAPI = require('./brawlAPI');

async function test() {
    console.log("Testing API with club tag:", process.env.CLUB_TAG);
    try {
        const members = await brawlAPI.getClubMembers(process.env.CLUB_TAG);
        console.log(`Success! Found ${members.length} members in the club.`);
        console.log(`Top member: ${members[0].name} - ${members[0].trophies} trophies`);
    } catch (e) {
        console.error('Failed:', e.message);
    }
}

test();
