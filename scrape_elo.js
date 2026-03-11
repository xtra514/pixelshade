async function scrapeRankedElo(tag) {
    try {
        const cleanTag = tag.replace('#', '');
        console.log(`Scraping Elo for ${cleanTag} via got-scraping...`);

        // Dynamically import got-scraping since it's an ES Module
        const { gotScraping } = await import('got-scraping');

        let response;
        if (process.env.SCRAPINGANT_KEY) {
            console.log(`Using ScrapingAnt API for Elo scrape...`);
            const scrapingAntUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(`https://brawlytix.com/profile/${cleanTag}`)}&x-api-key=${process.env.SCRAPINGANT_KEY}`;
            response = await gotScraping({ url: scrapingAntUrl });
        } else {
            console.log(`Using CORSProxy API (Will fail on Render)...`);
            const urlToScrape = `https://brawlytix.com/profile/${cleanTag}`;
            response = await gotScraping({
                url: `https://corsproxy.io/?${encodeURIComponent(urlToScrape)}`,
                headerGeneratorOptions: {
                    browsers: [{ name: 'chrome', minVersion: 110 }],
                    devices: ['desktop'],
                    locales: ['en-US']
                }
            });
        }

        const html = response.body;

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
