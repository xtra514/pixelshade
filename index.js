// Force IPv4 DNS resolution to prevent hang on Render's IPv6 configuration
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const brawlAPI = require('./brawlAPI');
const tracker = require('./tracker');
const { scrapeRankedElo } = require('./scrape_elo');

const app = express();
app.get('/', (req, res) => {
    res.send('Bot is tracking away! I am alive.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
});

function getMods() {
    try {
        if (!fs.existsSync('./mods.json')) return [];
        return JSON.parse(fs.readFileSync('./mods.json', 'utf8'));
    } catch { return []; }
}
function saveMods(mods) {
    fs.writeFileSync('./mods.json', JSON.stringify(mods, null, 2));
}

function isOwner(message) {
    if (message.guild && message.guild.ownerId === message.author.id) return true;
    if (process.env.OWNER_ID && message.author.id === process.env.OWNER_ID) return true;
    return false;
}

function hasPermission(message) {
    if (isOwner(message)) return true;
    const mods = getMods();
    return mods.includes(message.author.id);
}

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Re-enabled so your commands will work!
    ],
    ws: {
        properties: {
            browser: 'Discord iOS'
        }
    }
});

// Enable verbose debug logging to catch connection hanging on Render
client.on('debug', console.log);

// When the client is ready, run this code (only once)
client.once('clientReady', () => {
    console.log(`Ready! Logged in as ${client.user.tag}`);

    // Automated Ranked Elo Tracker
    setInterval(async () => {
        const data = tracker.getTrackingData();
        if (!data.isEloTracking || !data.eloMembers) return;

        try {
            console.log("Checking Battlelogs for Ranked Elo updates...");
            for (const member of data.eloMembers) {
                try {
                    // Fetch recent battles (free & unlimited)
                    const logs = await brawlAPI.getBattlelog(member.tag);
                    if (!logs || logs.length === 0) continue;

                    // Find latest competitive ranked match chronologically
                    const latestRanked = logs.find(l => l.battle.type === 'soloRanked' || l.battle.type === 'teamRanked');
                    if (!latestRanked) continue;

                    // If this is a new ranked match they just played
                    if (!member.lastBattleTime || latestRanked.battleTime > member.lastBattleTime) {
                        console.log(`New Ranked match detected for ${member.name}. Waiting 10s for Brawlytix to sync...`);
                        await sleep(10000); // Server Sync Buffer

                        // Targeted proxy request to Brawlytix to get exact new Elo
                        const scrapeData = await queueScrape(member.tag);
                        if (scrapeData !== null) {
                            tracker.updateEloForMember(member.tag, scrapeData.elo, scrapeData.skill, latestRanked.battleTime);
                            console.log(`Successfully updated ${member.name} Elo to ${scrapeData.elo} and Skill to ${scrapeData.skill}`);
                        } else {
                            // Failed to scrape (timeout), but mark battle as seen so we don't spam it later
                            tracker.updateEloForMember(member.tag, null, null, latestRanked.battleTime);
                        }

                        // CRITICAL: Prevent 409 Concurrent Limit errors on Free Tier if 2+ people finish games at the same time
                        await sleep(4000);
                    }
                } catch (e) {
                    console.error(`Background Tracker Error for ${member.name}:`, e.message);
                }
            }
        } catch (error) {
            console.error(error);
        }
    }, 1 * 60 * 1000); // Run every 1 minute
});

// Enable verbose debug logging to catch connection hanging on Render
client.on('debug', console.log);

// Global Scrape Queue logic
global.isScraping = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function queueScrape(tag) {
    while (global.isScraping) {
        await sleep(1000); // Wait in line
    }
    global.isScraping = true;
    try {
        const elo = await scrapeRankedElo(tag);
        return elo;
    } finally {
        await sleep(3500); // Mandatory cooldown before releasing the lock
        global.isScraping = false;
    }
}

// Listen for messages
client.on('messageCreate', async message => {
    // Ignore messages from bots to prevent infinite loops
    if (message.author.bot) return;

    // Brawl Stars Club Tracker Commands
    const args = message.content.trim().split(/ +/);
    const commandName = args[0].toLowerCase();

    if (commandName === '!add-mod') {
        if (!isOwner(message)) return message.reply('❌ Only the bot owner can add moderators.');
        const target = message.mentions.users.first();
        if (!target) return message.reply('❌ Please mention a user to add as a mod. Example: `!add-mod @user`');

        let mods = getMods();
        if (!mods.includes(target.id)) {
            mods.push(target.id);
            saveMods(mods);
            return message.reply(`✅ Added **${target.username}** as a bot moderator!`);
        } else {
            return message.reply(`⚠️ **${target.username}** is already a bot moderator.`);
        }
    }

    if (commandName === '!remove-mod') {
        if (!isOwner(message)) return message.reply('❌ Only the bot owner can remove moderators.');
        const target = message.mentions.users.first();
        if (!target) return message.reply('❌ Please mention a user to remove. Example: `!remove-mod @user`');

        let mods = getMods();
        if (mods.includes(target.id)) {
            mods = mods.filter(id => id !== target.id);
            saveMods(mods);
            return message.reply(`✅ Removed **${target.username}** from bot moderators.`);
        } else {
            return message.reply(`⚠️ **${target.username}** is not a bot moderator.`);
        }
    }

    if (commandName === '!start-tracking') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        const clubTag = process.env.CLUB_TAG;
        if (!clubTag || !process.env.BRAWL_STARS_TOKEN) {
            return message.reply('❌ Bot is missing BRAWL_STARS_TOKEN or CLUB_TAG in .env');
        }

        try {
            message.reply('⏳ Fetching full profiles for all club members (this takes a few seconds)...');
            const clubMembers = await brawlAPI.getClubMembers(clubTag);

            const fetchPromises = clubMembers.map(m => brawlAPI.getPlayer(m.tag));
            const fullProfiles = await Promise.all(fetchPromises);

            const validProfiles = fullProfiles.filter(p => p !== null);

            tracker.startTracking(validProfiles);
            message.reply(`✅ Started tracking **${validProfiles.length}** members from club **${clubTag}**!`);
        } catch (error) {
            message.reply(`❌ ${error.message}`);
        }
        return;
    }

    if (commandName === '!trophies') {
        const data = tracker.getTrackingData();
        if (!data.isTracking) {
            return message.reply('❌ Tracking has not been started. Use `!start-tracking` first.');
        }

        try {
            const waitMsg = await message.reply('⏳ Fetching live stats for all members (this takes a few seconds)...');

            const results = [];
            const fetchPromises = data.members.map(async (baseline) => {
                const currentMember = await brawlAPI.getPlayer(baseline.tag);
                if (currentMember) {
                    const gained = currentMember.trophies - baseline.baselineTrophies;
                    results.push({
                        name: baseline.name,
                        gained: gained,
                        current: currentMember.trophies
                    });
                }
            });

            await Promise.all(fetchPromises);

            results.sort((a, b) => b.gained - a.gained);

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('🏆 Trophies Gained Leaderboard 🏆')
                .setTimestamp();

            let description = `*Since: ${new Date(data.startTime).toLocaleDateString()}*\n\n`;

            results.slice(0, 5).forEach((member, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
                let sign = member.gained > 0 ? '+' : '';
                description += `${medal} **${member.name}**: ${sign}${member.gained} gained (${member.current} total)\n`;
            });

            embed.setDescription(description);

            // Add "Show All" Button
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('show_all_trophies')
                    .setLabel('Show All (30)')
                    .setStyle(ButtonStyle.Primary)
            );

            await waitMsg.edit({ content: null, embeds: [embed], components: [row] });
        } catch (error) {
            message.reply(`❌ ${error.message}`);
        }
        return;
    }

    if (commandName === '!grind') {
        const data = tracker.getTrackingData();
        if (!data.isTracking) {
            return message.reply('❌ Tracking has not been started. Use `!start-tracking` first.');
        }

        try {
            const waitMsg = await message.reply('⏳ Calculating fair Grind Scores from live API (this takes a few seconds)...');

            const results = [];

            // Re-fetch all members to compare current vs baseline Brawler stats
            const fetchPromises = data.members.map(async (baseline) => {
                const currentMember = await brawlAPI.getPlayer(baseline.tag);
                if (currentMember && currentMember.brawlers) {
                    let totalGrindPoints = 0;

                    // Compare every brawler they own
                    currentMember.brawlers.forEach(currentBrawler => {
                        const baseBrawler = baseline.brawlers ? baseline.brawlers.find(b => b.id === currentBrawler.id) : null;
                        const baselineTrophies = baseBrawler ? baseBrawler.trophies : 0; // 0 if it's a brand new brawler

                        // How many trophies did this specific brawler gain?
                        const trophiesGained = currentBrawler.trophies - baselineTrophies;

                        if (trophiesGained > 0) {
                            // Apply incremental Multipliers based on Trophy Brackets
                            const brackets = [
                                { min: 0, max: 999, mult: 0.5 },
                                { min: 1000, max: 1999, mult: 1.0 },
                                { min: 2000, max: 2499, mult: 3.0 },
                                { min: 2500, max: 2699, mult: 6.0 },
                                { min: 2700, max: 2999, mult: 12.0 },
                                { min: 3000, max: 3099, mult: 25.0 },
                                { min: 3100, max: 3499, mult: 50.0 },
                                { min: 3500, max: 3999, mult: 75.0 },
                                { min: 4000, max: Infinity, mult: 100.0 }
                            ];

                            let tempPoints = 0;
                            let currentTrophies = baselineTrophies;
                            const targetTrophies = currentBrawler.trophies;

                            for (const bracket of brackets) {
                                if (currentTrophies > bracket.max) continue; // Skip brackets below current trophies
                                if (currentTrophies >= targetTrophies) break; // Reached target

                                const endOfBracket = Math.min(targetTrophies, bracket.max + 1);
                                const trophiesInBracket = endOfBracket - currentTrophies;

                                tempPoints += (trophiesInBracket * bracket.mult);
                                currentTrophies = endOfBracket;
                            }

                            totalGrindPoints += tempPoints;

                            // Add huge one-time bonus for hitting new Prestige Ranks
                            let prestigeBonus = 0;
                            if (baselineTrophies < 1000 && currentBrawler.trophies >= 1000) prestigeBonus += 100;
                            if (baselineTrophies < 2000 && currentBrawler.trophies >= 2000) prestigeBonus += 500;
                            if (baselineTrophies < 3000 && currentBrawler.trophies >= 3000) prestigeBonus += 2000;
                            if (baselineTrophies < 4000 && currentBrawler.trophies >= 4000) prestigeBonus += 10000;
                            if (baselineTrophies < 5000 && currentBrawler.trophies >= 5000) prestigeBonus += 15000;

                            totalGrindPoints += prestigeBonus;
                        }
                    });

                    results.push({
                        name: baseline.name,
                        grindPoints: Math.floor(totalGrindPoints),
                        rawGained: currentMember.trophies - baseline.baselineTrophies
                    });
                }
            });

            await Promise.all(fetchPromises);

            results.sort((a, b) => b.grindPoints - a.grindPoints);

            const embed = new EmbedBuilder()
                .setColor('#FF4500')
                .setTitle('🔥 Grind Leaderboard 🔥')
                .setTimestamp();

            let description = `*Since: ${new Date(data.startTime).toLocaleDateString()}*\n\n`;

            results.slice(0, 5).forEach((member, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
                const rankStr = String(index + 1).padStart(2, '0');
                const ptsStr = member.grindPoints.toLocaleString().padStart(5, ' ');
                description += `\`#${rankStr}\` ${medal} \`${ptsStr} Pts\` | **${member.name}**\n`;
            });

            embed.setDescription(description);

            // Add "Show All" Button
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('show_all_grind')
                    .setLabel('Show All (30)')
                    .setStyle(ButtonStyle.Primary)
            );

            await waitMsg.edit({ content: null, embeds: [embed], components: [row] });
        } catch (error) {
            message.reply(`❌ ${error.message}`);
        }
        return;
    }

    if (commandName === '!end-tracking') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        tracker.endTracking();
        message.reply('🛑 Tracking has been stopped. Use `!start-tracking` when a new season begins.');
        return;
    }

    if (commandName === '!grind-help') {
        const embed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('📖 How Fair Grind Points Work')
            .setDescription(
                "Because getting wins at higher Trophies is significantly harder (and rewards fewer raw trophies in Prestige 3+), we use a custom point system tailored to **Brawler Prestige Ranges!**\n\n" +
                "Every single Raw Trophy you gain on a Brawler is multiplied based on that Brawler's CURRENT trophy count:\n\n" +
                "**🏆 The Trophy Multipliers:**\n" +
                "`0   - 999  Tr` = **x0.5** Grind Points per trophy\n" +
                "`1000 - 1999 Tr` = **x1** Grind Points per trophy\n" +
                "`2000 - 2499 Tr` = **x3** Grind Points per trophy\n" +
                "`2500 - 2699 Tr` = **x6** Grind Points per trophy\n" +
                "`2700 - 2999 Tr` = **x12** Grind Points per trophy\n" +
                "`3000 - 3099 Tr` = **x25** Grind Points per trophy\n" +
                "`3100 - 3499 Tr` = **x50** Grind Points per trophy\n" +
                "`3500 - 3999 Tr` = **x75** Grind Points per trophy\n" +
                "`4000+       Tr` = **x100** Grind Points per trophy\n\n" +
                "**🚀 One-Time Prestige Rank-Up Bonuses!**\n" +
                "If you push a Brawler into a completely new Prestige Tier, you get a massive flat point bonus added to your score:\n" +
                "• Hit **1,000** Tr (Prestige 1) = **+100 Points**\n" +
                "• Hit **2,000** Tr (Prestige 2) = **+500 Points**\n" +
                "• Hit **3,000** Tr (Prestige 3) = **+2,000 Points**\n" +
                "• Hit **4,000** Tr (Prestige 4) = **+10,000 Points**\n" +
                "• Hit **5,000** Tr (Prestige 5) = **+15,000 Points**\n"
            )
            .setFooter({ text: 'Grind hard.' });

        message.reply({ embeds: [embed] });
        return;
    }

    if (commandName === '!start-elo') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        const clubTag = process.env.CLUB_TAG;
        if (!clubTag) return message.reply('❌ CLUB_TAG is not set in the .env file.');

        if (global.isScraping) {
            return message.reply('⏳ **A scrape session is currently active.** Please wait a few minutes before trying again.');
        }
        global.isScraping = true;

        try {
            const waitMsg = await message.reply('⏳ **Initializing Automated Elo Tracker...**\nFetching current members and performing a baseline bulk proxy scrape (may take a minute or two)...');

            const members = await brawlAPI.getClubMembers(clubTag);
            if (!members || members.length === 0) return waitMsg.edit('❌ Cannot find club members.');

            // Store baseline
            const eloMembers = tracker.startEloTracking(members);

            // Do an initial loop to grab current Elo for everyone immediately
            let successes = 0;

            for (const member of eloMembers) {
                const logs = await brawlAPI.getBattlelog(member.tag);
                let lastTime = null;
                if (logs && logs.length > 0) {
                    const latest = logs.find(l => l.battle.type === 'soloRanked' || l.battle.type === 'teamRanked');
                    if (latest) lastTime = latest.battleTime;
                }

                // Instead of using queueScrape, we already hold the master bot lock for this loop
                const scrapeData = await scrapeRankedElo(member.tag);
                if (scrapeData !== null) {
                    tracker.updateEloForMember(member.tag, scrapeData.elo, scrapeData.skill, lastTime);
                    successes++;

                    // Live Feedback on Discord
                    await waitMsg.edit(`⏳ **Initializing Automated Elo Tracker...**\n✅ Successfully scraped baselines for **${successes}/${members.length}** members so far...\n*(Waiting 4 seconds between members to prevent API Rate Limits)*`);
                }

                await sleep(4000); // 4 second delay to prevent Brawlytix / ScrapingAnt blocks
            }
            await waitMsg.edit(`✅ **Automated Elo Tracking Started!**\nSuccessfully scraped baselines for **${successes}/${members.length}** members.\nThe bot will now silently monitor battle logs every 2 minutes and automatically update Elo when someone plays Ranked.`);
        } catch (error) {
            message.reply(`❌ ${error.message}`);
        } finally {
            global.isScraping = false; // Release the lock
        }
        return;
    }

    if (commandName === '!rank') {
        const data = tracker.getTrackingData();
        if (!data.isEloTracking || !data.eloMembers) {
            return message.reply('❌ Automated Elo Tracking has not been started. Use `!start-elo` first.');
        }

        const sorted = data.eloMembers
            .filter(m => m.currentElo !== null)
            .sort((a, b) => b.currentElo - a.currentElo);

        if (sorted.length === 0) return message.reply('❌ No Ranked data available yet.');

        const embed = new EmbedBuilder()
            .setColor('#E91E63')
            .setTitle('🏆 Live Ranked Elo Leaderboard')
            .setTimestamp();

        let desc = '';
        sorted.slice(0, 5).forEach((member, i) => {
            desc += `**${i + 1}.** ${member.name}: \`${member.currentElo.toLocaleString()}\` Elo\n`;
        });

        embed.setDescription(desc);

        // Add "Show All" Button
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('show_all_rank')
                .setLabel('Show All (30)')
                .setStyle(ButtonStyle.Primary)
        );

        message.reply({ embeds: [embed], components: [row] });
        return;
    }

    if (commandName === '!skill') {
        const data = tracker.getTrackingData();
        if (!data.isEloTracking || !data.eloMembers) {
            return message.reply('❌ Automated Tracking has not been started. Use `!start-elo` first.');
        }

        const sorted = data.eloMembers
            .filter(m => m.currentSkill !== null)
            .sort((a, b) => b.currentSkill - a.currentSkill);

        if (sorted.length === 0) return message.reply('❌ No Skill Score data available yet.');

        const embed = new EmbedBuilder()
            .setColor('#00FFFF')
            .setTitle('🎯 Live Skill Score Leaderboard')
            .setTimestamp();

        let desc = '';
        sorted.slice(0, 5).forEach((member, i) => {
            desc += `**${i + 1}.** ${member.name}: \`${member.currentSkill}\` / 10\n`;
        });

        embed.setDescription(desc);

        // Add "Show All" Button
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('show_all_skill')
                .setLabel('Show All (30)')
                .setStyle(ButtonStyle.Primary)
        );

        message.reply({ embeds: [embed], components: [row] });
        return;
    }

    if (commandName === '!elo') {
        const tag = args[1];
        if (!tag) return message.reply('❌ Please provide a player tag. Example: `!elo #PUP09U9Q`');

        try {
            const waitMsg = await message.reply('⏳ Getting into queue... Bypassing Cloudflare and scraping Brawlytix (may take 10-15 seconds)');
            const scrapeData = await queueScrape(tag);

            if (scrapeData !== null) {
                const skillStr = scrapeData.skill ? ` | Skill: **${scrapeData.skill}**` : '';
                await waitMsg.edit(`✅ **Player ${tag}** has an exact Ranked Elo of: **${scrapeData.elo.toLocaleString()}** 🏆${skillStr}`);
            } else {
                await waitMsg.edit(`❌ Could not find Ranked Elo for ${tag}. This either means they haven't played Ranked mode, or the scraper timed out.`);
            }
        } catch (error) {
            console.error(error);
            message.reply('❌ Failed to extract Elo due to a server error.');
        }
        return;
    }

    if (commandName === '!ranked') {
        const targetTag = args[1];
        if (!targetTag) return message.reply('❌ Please provide a player tag. Example: `!ranked #PUP09U9Q`');

        try {
            const waitMsg = await message.reply(`⏳ Fetching recent battle logs for **${targetTag}**...`);

            const logs = await brawlAPI.getBattlelog(targetTag);
            if (!logs || logs.length === 0) {
                return waitMsg.edit(`❌ No battle logs found for **${targetTag}** or the API is unavailable.`);
            }

            let rankedWins = 0;
            let rankedLosses = 0;
            let rankedDraws = 0;
            let starPlayerCount = 0;
            let highestCalculatedRank = 0;

            logs.forEach(log => {
                if (log.battle.type === 'soloRanked' || log.battle.type === 'teamRanked' || log.battle.mode === 'ranked' || log.battle.type === 'ranked') {
                    if (log.battle.result === 'victory') rankedWins++;
                    else if (log.battle.result === 'defeat') rankedLosses++;
                    else if (log.battle.result === 'draw') rankedDraws++;

                    const normalizedTargetTag = targetTag.replace(/^#/, '').replace(/^%23/i, '').toUpperCase();
                    if (log.battle.starPlayer && log.battle.starPlayer.tag === `#${normalizedTargetTag}`) {
                        starPlayerCount++;
                    }

                    // Extract the Ranked Tier from the 'trophies' property (Supercell API quirk)
                    if (log.battle.type === 'soloRanked' || log.battle.type === 'teamRanked') {
                        if (log.battle.teams) {
                            log.battle.teams.forEach(team => {
                                team.forEach(player => {
                                    if (player.tag === `#${normalizedTargetTag}` && player.brawler && player.brawler.trophies > highestCalculatedRank && player.brawler.trophies < 30) {
                                        highestCalculatedRank = player.brawler.trophies;
                                    }
                                });
                            });
                        }
                    }
                }
            });

            const totalRanked = rankedWins + rankedLosses + rankedDraws;

            // Load persistent ranking data
            let savedRanks = {};
            if (fs.existsSync(DATA_FILE)) {
                try {
                    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                    if (data.ranks) savedRanks = data.ranks;
                } catch (e) {
                    console.error('Error reading data.json for ranks:', e);
                }
            }

            // Update persistent rank if the scanned rank is higher
            if (highestCalculatedRank > 0) {
                if (!savedRanks[normalizedTargetTag] || highestCalculatedRank > savedRanks[normalizedTargetTag]) {
                    savedRanks[normalizedTargetTag] = highestCalculatedRank;
                    try {
                        let fullData = {};
                        if (fs.existsSync(DATA_FILE)) {
                            fullData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                        }
                        fullData.ranks = savedRanks;
                        fs.writeFileSync(DATA_FILE, JSON.stringify(fullData, null, 2), 'utf8');
                    } catch (e) {
                        console.error('Error saving ranks to data.json:', e);
                    }
                }
            } else if (savedRanks[normalizedTargetTag]) {
                // Keep the previous highest rank if they haven't played recently
                highestCalculatedRank = savedRanks[normalizedTargetTag];
            }

            if (totalRanked === 0 && highestCalculatedRank === 0) {
                return waitMsg.edit(`⚠️ **${targetTag}** has not played any Ranked matches recently, and I have no saved record of their Rank.`);
            }

            const winRate = totalRanked > 0 ? ((rankedWins / totalRanked) * 100).toFixed(1) : 0;

            const ranksMap = [
                "Unranked",
                "Bronze I", "Bronze II", "Bronze III",
                "Silver I", "Silver II", "Silver III",
                "Gold I", "Gold II", "Gold III",
                "Diamond I", "Diamond II", "Diamond III",
                "Mythic I", "Mythic II", "Mythic III",
                "Legendary I", "Legendary II", "Legendary III",
                "Masters"
            ];

            const currentRankName = ranksMap[highestCalculatedRank] || `Tier ${highestCalculatedRank}`;

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle(`⚔️ Ranked Performance: ${targetTag}`)
                .setDescription(`**Current Rank:** ${currentRankName}\n*Based on the last ${logs.length} battles:*`)
                .addFields(
                    { name: '🟢 Wins', value: `**${rankedWins}**`, inline: true },
                    { name: '🔴 Losses', value: `**${rankedLosses}**`, inline: true },
                    { name: '⚪ Draws', value: `**${rankedDraws}**`, inline: true },
                    { name: '📊 Win Rate', value: `**${winRate}%**`, inline: true },
                    { name: '⭐ Star Player', value: `**${starPlayerCount} times**`, inline: true }
                )
                .setFooter({ text: `Brawl Stars Ranked Stats • ${totalRanked} Ranked Matches Found` })
                .setTimestamp();

            await waitMsg.edit({ content: null, embeds: [embed] });

        } catch (error) {
            message.reply('❌ An error occurred while calculating the ranked stats. Make sure the tag is correct.');
        }
        return;
    }

    // Existing Simple commands
    if (commandName === '!ping') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        message.reply('Pong!');
        return;
    }

    if (commandName === 'hello') {
        message.reply(`Hello there, ${message.author.username}!`);
        return;
    }
});

// Listen for button clicks (Interactions)
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const data = tracker.getTrackingData();
    if (!data) {
        return interaction.reply({ content: '❌ Tracking data is not available.', ephemeral: true });
    }

    try {
        await interaction.deferUpdate(); // Acknowledge the click so it doesn't fail

        if (interaction.customId === 'show_all_trophies') {
            const results = [];
            const fetchPromises = data.members.map(async (baseline) => {
                const currentMember = await brawlAPI.getPlayer(baseline.tag);
                if (currentMember) {
                    results.push({
                        name: baseline.name,
                        gained: currentMember.trophies - baseline.baselineTrophies,
                        current: currentMember.trophies
                    });
                }
            });
            await Promise.all(fetchPromises);
            results.sort((a, b) => b.gained - a.gained);

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('🏆 Full Trophies Gained Leaderboard 🏆')
                .setTimestamp();

            let description = `*Since: ${new Date(data.startTime).toLocaleDateString()}*\n\n`;
            results.forEach((member, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
                let sign = member.gained > 0 ? '+' : '';
                description += `${medal} **${member.name}**: ${sign}${member.gained} gained (${member.current} total)\n`;
            });

            embed.setDescription(description);
            await interaction.editReply({ embeds: [embed], components: [] }); // Remove the button
        }

        if (interaction.customId === 'show_all_grind') {
            const results = [];
            const fetchPromises = data.members.map(async (baseline) => {
                const currentMember = await brawlAPI.getPlayer(baseline.tag);
                if (currentMember && currentMember.brawlers) {
                    let totalGrindPoints = 0;
                    currentMember.brawlers.forEach(currentBrawler => {
                        const baseBrawler = baseline.brawlers ? baseline.brawlers.find(b => b.id === currentBrawler.id) : null;
                        const baselineTrophies = baseBrawler ? baseBrawler.trophies : 0;
                        const trophiesGained = currentBrawler.trophies - baselineTrophies;

                        if (trophiesGained > 0) {
                            const brackets = [
                                { min: 0, max: 999, mult: 0.5 },
                                { min: 1000, max: 1999, mult: 1.0 },
                                { min: 2000, max: 2499, mult: 3.0 },
                                { min: 2500, max: 2699, mult: 6.0 },
                                { min: 2700, max: 2999, mult: 12.0 },
                                { min: 3000, max: 3099, mult: 25.0 },
                                { min: 3100, max: 3499, mult: 50.0 },
                                { min: 3500, max: 3999, mult: 75.0 },
                                { min: 4000, max: Infinity, mult: 100.0 }
                            ];

                            let tempPoints = 0;
                            let currentTrophies = baselineTrophies;
                            const targetTrophies = currentBrawler.trophies;

                            for (const bracket of brackets) {
                                if (currentTrophies > bracket.max) continue; // Skip brackets below current trophies
                                if (currentTrophies >= targetTrophies) break; // Reached target

                                const endOfBracket = Math.min(targetTrophies, bracket.max + 1);
                                const trophiesInBracket = endOfBracket - currentTrophies;

                                tempPoints += (trophiesInBracket * bracket.mult);
                                currentTrophies = endOfBracket;
                            }

                            totalGrindPoints += tempPoints;

                            // Add huge one-time bonus for hitting new Prestige Ranks
                            let prestigeBonus = 0;
                            if (baselineTrophies < 1000 && currentBrawler.trophies >= 1000) prestigeBonus += 100;
                            if (baselineTrophies < 2000 && currentBrawler.trophies >= 2000) prestigeBonus += 500;
                            if (baselineTrophies < 3000 && currentBrawler.trophies >= 3000) prestigeBonus += 2000;
                            if (baselineTrophies < 4000 && currentBrawler.trophies >= 4000) prestigeBonus += 10000;
                            if (baselineTrophies < 5000 && currentBrawler.trophies >= 5000) prestigeBonus += 15000;

                            totalGrindPoints += prestigeBonus;
                        }
                    });
                    results.push({ name: baseline.name, grindPoints: Math.floor(totalGrindPoints) });
                }
            });
            await Promise.all(fetchPromises);
            results.sort((a, b) => b.grindPoints - a.grindPoints);

            const embed = new EmbedBuilder()
                .setColor('#FF4500')
                .setTitle('🔥 Full Grind Leaderboard 🔥')
                .setTimestamp();

            let description = `*Since: ${new Date(data.startTime).toLocaleDateString()}*\n\n`;
            results.forEach((member, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
                const rankStr = String(index + 1).padStart(2, '0');
                const ptsStr = member.grindPoints.toLocaleString().padStart(5, ' ');
                description += `\`#${rankStr}\` ${medal} \`${ptsStr} Pts\` | **${member.name}**\n`;
            });

            embed.setDescription(description);
            await interaction.editReply({ embeds: [embed], components: [] }); // Remove the button
        }

        if (interaction.customId === 'show_all_rank') {
            if (!data.isEloTracking || !data.eloMembers) {
                return interaction.editReply({ content: '❌ Elo tracking is not active.', embeds: [], components: [] });
            }

            const sorted = data.eloMembers
                .filter(m => m.currentElo !== null)
                .sort((a, b) => b.currentElo - a.currentElo);

            const embed = new EmbedBuilder()
                .setColor('#E91E63')
                .setTitle('🏆 Full Ranked Elo Leaderboard')
                .setTimestamp();

            let desc = '';
            sorted.forEach((member, i) => {
                desc += `**${i + 1}.** ${member.name}: \`${member.currentElo.toLocaleString()}\` Elo\n`;
            });

            embed.setDescription(desc);
            await interaction.editReply({ content: null, embeds: [embed], components: [] });
        }

        if (interaction.customId === 'show_all_skill') {
            if (!data.isEloTracking || !data.eloMembers) {
                return interaction.editReply({ content: '❌ Tracking is not active.', embeds: [], components: [] });
            }

            const sorted = data.eloMembers
                .filter(m => m.currentSkill !== null)
                .sort((a, b) => b.currentSkill - a.currentSkill);

            const embed = new EmbedBuilder()
                .setColor('#00FFFF')
                .setTitle('🎯 Full Skill Score Leaderboard')
                .setTimestamp();

            let desc = '';
            sorted.forEach((member, i) => {
                desc += `**${i + 1}.** ${member.name}: \`${member.currentSkill}\` / 10\n`;
            });

            embed.setDescription(desc);
            await interaction.editReply({ content: null, embeds: [embed], components: [] });
        }

    } catch (error) {
        console.error("Interaction Error:", error);
    }
});

// Log in to Discord with your client's token
if (!process.env.DISCORD_TOKEN) {
    console.error("CRITICAL ERROR: DISCORD_TOKEN is absolutely missing from environment variables!");
} else {
    console.log(`Starting login process... (Token begins with: ${process.env.DISCORD_TOKEN.substring(0, 10)}...)`);
}

client.login(process.env.DISCORD_TOKEN).then(() => {
    console.log("Discord client login completed successfully.");
}).catch(err => {
    console.error("FATAL: Failed to login to Discord!", err);
});
