async function scrapeRankedElo(tag) {
    try {
        const cleanTag = tag.replace('#', '');
        console.log(`Scraping Elo for ${cleanTag} via got-scraping...`);

        let html;
        const keys = process.env.SCRAPINGANT_KEYS ? process.env.SCRAPINGANT_KEYS.split(',') : (process.env.SCRAPINGANT_KEY ? [process.env.SCRAPINGANT_KEY] : []);

        if (keys.length > 0) {
            console.log(`Using ScrapingAnt API Configuration (${keys.length} keys loaded for rotation)...`);
            const axios = require('axios');
            let success = false;

            for (let i = 0; i < keys.length; i++) {
                const key = keys[i].trim();
                try {
                    const scrapingAntUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(`https://brawlytix.com/profile/${cleanTag}`)}&x-api-key=${key}&browser=false`;

                    // Raw axios request directly to the API, omitting got-scraping's TLS spoofers
                    const res = await axios.get(scrapingAntUrl, { timeout: 20000 }); // 20-second proxy timeout
                    html = res.data;
                    success = true;
                    break; // We got the HTML successfully, break out of the loop
                } catch (apiError) {
                    console.error(`ScrapingAnt Key #${i + 1} Failed (Quota limits or Timeout):`, apiError.message);
                    if (i === keys.length - 1) {
                        console.error('All ScrapingAnt keys exhausted/failed.');
                        return null;
                    }
                }
            }
        } else {
            console.log(`Using CORSProxy API (Will fail on Render)...`);
            const urlToScrape = `https://brawlytix.com/profile/${cleanTag}`;
            // Dynamically import got-scraping since it's an ES Module
            const { gotScraping } = await import('got-scraping');
            const response = await gotScraping({
                url: `https://corsproxy.io/?${encodeURIComponent(urlToScrape)}`,
                headerGeneratorOptions: {
                    browsers: [{ name: 'chrome', minVersion: 110 }],
                    devices: ['desktop'],
                    locales: ['en-US']
                }
            });
            html = response.body;
        }

        // Brawlytix HTML structure: 6,405 <label>Ranked Elo</label>
        const eloMatch = html.match(/([\d,]+)\s*<label[^>]*>Ranked Elo<\/label>/i);

        if (eloMatch && eloMatch[1]) {
            const elo = parseInt(eloMatch[1].replace(/,/g, ''), 10);
            console.log(`Extracted Elo: ${elo}`);
            return elo;
        }

        console.log('Ranked Elo stat block not found in HTML.');
        return null;

    } catch (e) {
        console.error('Cloudscraper Error:', e.message || e);
        return null;
    }
}

// Quick Test if run directly
if (require.main === module) {
    scrapeRankedElo('PUP09U9Q').then(res => console.log('Final Result:', res));
}

module.exports = { scrapeRankedElo };
