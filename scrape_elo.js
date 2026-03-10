const cloudscraper = require('cloudscraper');

async function scrapeRankedElo(tag) {
    try {
        const cleanTag = tag.replace('#', '');
        console.log(`Scraping Elo for ${cleanTag} via cloudscraper...`);

        const html = await cloudscraper.get({
            uri: `https://brawlytix.com/profile/${cleanTag}`,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
        });

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
