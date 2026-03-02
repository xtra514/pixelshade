require('dotenv').config();
const brawlAPI = require('./brawlAPI');

async function testPlayer() {
    // Assuming the user is one of these members, we'll fetch the club, get the top guy, 
    // and manually fetch his player profile to see if the "players" endpoint is updated faster than the "club" endpoint.
    try {
        const clubTag = process.env.CLUB_TAG;
        const members = await brawlAPI.getClubMembers(clubTag);

        console.log(`Club API returned ${members[0].name} with ${members[0].trophies} trophies`);

        // Now fetch that specific player
        const playerTag = members[0].tag.replace('#', '');

        const axios = require('axios');
        const API_KEY = process.env.BRAWL_STARS_TOKEN;
        const response = await axios.get(`https://api.brawlstars.com/v1/players/%23${playerTag}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/json'
            }
        });

        console.log(`Player API returned ${response.data.name} with ${response.data.trophies} trophies`);

    } catch (e) {
        console.error('Failed:', e.response?.data || e.message);
    }
}

testPlayer();
