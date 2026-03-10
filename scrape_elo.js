const puppeteer = require('puppeteer');

async function scrapeRankedElo(tag) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Crucial for 512MB RAM limit
            '--disable-gpu',
            '--js-flags="--max-old-space-size=128"' // Limit JS heap
        ]
    });

    try {
        const page = await browser.newPage();

        // Optimize memory by blocking everything except the HTML document
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media', 'manifest', 'other'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Set a standard User Agent to help with Cloudflare
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`Scraping Elo for ${tag}...`);
        const cleanTag = tag.replace('#', '');
        await page.goto(`https://brawlytix.com/profile/${cleanTag}`, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Wait up to 5s for Cloudflare logic to finish and the player div to load
        await page.waitForSelector('.stat', { timeout: 10000 }).catch(() => null);

        const elo = await page.evaluate(() => {
            const divs = Array.from(document.querySelectorAll('.stat'));
            const eloDiv = divs.find(d => d.textContent.includes('Ranked Elo'));
            if (eloDiv) {
                // Return just the number, removing the commas and labels
                return parseInt(eloDiv.textContent.replace('Ranked Elo', '').replace(/,/g, '').trim(), 10);
            }
            return null;
        });

        console.log(`Extracted Elo: ${elo !== null ? elo : 'Not Found'}`);
        return elo;

    } catch (e) {
        console.error('Puppeteer Error:', e.message);
        return null;
    } finally {
        await browser.close();
    }
}

// Quick Test if run directly
if (require.main === module) {
    scrapeRankedElo('PUP09U9Q').then(res => console.log('Final Result:', res));
}

module.exports = { scrapeRankedElo };
