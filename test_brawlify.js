const axios = require('axios');

async function testBrawlify() {
    try {
        const playerTag = "LJ8JVUPYQ";
        console.log(`Testing brawlify API for player ${playerTag}...`);

        const response = await axios.get(`https://api.brawlify.com/v1/player/${playerTag}`);
        const data = response.data;

        console.log("Success! Keys:", Object.keys(data));
        console.log("Ranked related keys:", Object.keys(data).filter(k => k.toLowerCase().includes('rank') || k.toLowerCase().includes('elo')));
        console.log(JSON.stringify(data, null, 2).substring(0, 1000));

    } catch (e) {
        console.error('Failed:', e.message);
        if (e.response) {
            console.error('Response:', e.response.status);
        }
    }
}

testBrawlify();
