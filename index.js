require('dotenv').config();
const fs = require('fs');
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const brawlAPI = require('./brawlAPI');
const tracker = require('./tracker');

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

async function isOwner(message) {
    if (process.env.OWNER_ID && message.author.id === process.env.OWNER_ID) return true;

    // Fetch Discord Application Owner
    if (!client.application?.owner) await client.application?.fetch();
    const owner = client.application?.owner;

    if (owner?.id === message.author.id) return true;
    if (owner?.members && owner.members.has(message.author.id)) return true; // Handling Teams

    return false;
}

async function hasPermission(message) {
    if (await isOwner(message)) return true;
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
});

// When the client is ready, run this code (only once)
client.once('clientReady', () => {
    console.log(`Ready! Logged in as ${client.user.tag}`);
});

// Listen for messages
client.on('messageCreate', async message => {
    // Ignore messages from bots to prevent infinite loops
    if (message.author.bot) return;

    // Brawl Stars Club Tracker Commands
    const args = message.content.trim().split(/ +/);
    const commandName = args[0].toLowerCase();

    if (commandName === '!add-mod') {
        if (!(await isOwner(message))) return message.reply('❌ Only the bot owner can add moderators.');
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
        if (!(await isOwner(message))) return message.reply('❌ Only the bot owner can remove moderators.');
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
        if (!(await hasPermission(message))) return message.reply('❌ You do not have permission to use this command.');
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
                            // Apply exact Multipliers provided by the server owner
                            let finalMultiplier = 0.5;

                            if (currentBrawler.trophies >= 4000) finalMultiplier = 100.0;
                            else if (currentBrawler.trophies >= 3500) finalMultiplier = 75.0;
                            else if (currentBrawler.trophies >= 3100) finalMultiplier = 50.0;
                            else if (currentBrawler.trophies >= 3000) finalMultiplier = 25.0;
                            else if (currentBrawler.trophies >= 2700) finalMultiplier = 12.0;
                            else if (currentBrawler.trophies >= 2500) finalMultiplier = 6.0;
                            else if (currentBrawler.trophies >= 2000) finalMultiplier = 3.0;
                            else if (currentBrawler.trophies >= 1000) finalMultiplier = 1.0;
                            else finalMultiplier = 0.5; // 0-999

                            totalGrindPoints += (trophiesGained * finalMultiplier);

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
        if (!(await hasPermission(message))) return message.reply('❌ You do not have permission to use this command.');
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

    // Existing Simple commands
    if (commandName === '!ping') {
        if (!(await hasPermission(message))) return message.reply('❌ You do not have permission to use this command.');
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
    if (!data.isTracking || !data.members) {
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
                            let finalMultiplier = 0.5;
                            if (currentBrawler.trophies >= 4000) finalMultiplier = 100.0;
                            else if (currentBrawler.trophies >= 3500) finalMultiplier = 75.0;
                            else if (currentBrawler.trophies >= 3100) finalMultiplier = 50.0;
                            else if (currentBrawler.trophies >= 3000) finalMultiplier = 25.0;
                            else if (currentBrawler.trophies >= 2700) finalMultiplier = 12.0;
                            else if (currentBrawler.trophies >= 2500) finalMultiplier = 6.0;
                            else if (currentBrawler.trophies >= 2000) finalMultiplier = 3.0;
                            else if (currentBrawler.trophies >= 1000) finalMultiplier = 1.0;
                            else finalMultiplier = 0.5;

                            totalGrindPoints += (trophiesGained * finalMultiplier);

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
