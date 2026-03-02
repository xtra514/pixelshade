const axios = require('axios');

async function testUnofficial() {
    try {
        const playerTag = "LJ8JVUPYQ";
        console.log(`Testing brawlapi.com for player ${playerTag}...`);

        const response = await axios.get(`https://api.brawlapi.com/v1/players/%23${playerTag}`);
        const data = response.data;

        if (data.ranked) {
            console.log("Found Ranked data on Unofficial API!");
            console.log(data.ranked);
        } else {
            console.log("No 'ranked' object found.");
            // Print all keys just in case
            console.log("Keys:", Object.keys(data));
        }
    } catch (e) {
        console.error('Failed:', e.message);
    }
}

testUnofficial();
