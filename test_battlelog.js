require('dotenv').config();
const axios = require('axios');
const API_KEY = process.env.BRAWL_STARS_TOKEN;

const apiClient = axios.create({
    baseURL: 'https://api.brawlstars.com/v1',
    headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json'
    }
});

async function checkBattleLog() {
    try {
        console.log("Fetching battlelog for top player...");
        const res = await apiClient.get(`/players/%23LJ8JVUPYQ/battlelog`);
        const battles = res.data.items;

        let rankedBattlesFound = 0;
        console.log(`Retrieved ${battles.length} battles.`);

        if (battles.length > 0) {
            console.log("Battle item keys:", Object.keys(battles[0]));
            console.log("BattleTime exists?", battles[0].battleTime);
            console.log(battles[0].battleTime);
        }
    } catch (e) {
        console.log("Failed:", e.message);
    }
}

checkBattleLog();
