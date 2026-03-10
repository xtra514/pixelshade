async function scrapeRankedElo(tag) {
    try {
        const cleanTag = tag.replace('#', '');
        console.log(`Scraping Elo for ${cleanTag} via got-scraping...`);

        // Dynamically import got-scraping since it's an ES Module
        const { gotScraping } = await import('got-scraping');

        const urlToScrape = `https://brawlytix.com/profile/${cleanTag}`;
        const response = await gotScraping({
            url: `https://corsproxy.io/?${encodeURIComponent(urlToScrape)}`,
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 110 }],
                devices: ['desktop'],
                locales: ['en-US']
            }
        });

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
