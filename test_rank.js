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

async function checkTopPlayers() {
    try {
        console.log("Fetching top global player...");
        const res = await apiClient.get('/rankings/global/players?limit=1');
        const p = res.data.items[0];

        console.log(`Checking player ${p.name} (${p.tag})...`);
        const profileRes = await apiClient.get(`/players/${p.tag.replace('#', '%23')}`);
        const profile = profileRes.data;

        console.log("ALL KEYS:", Object.keys(profile));
    } catch (e) {
        console.log("Failed:", e.message);
    }
}

checkTopPlayers();
