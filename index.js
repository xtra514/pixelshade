// Force IPv4 DNS resolution to prevent hang on Render's IPv6 configuration
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

const fs = require('fs');
const path = require('path');
const express = require('express');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    GatewayIntentBits,
    PermissionFlagsBits
} = require('discord.js');
const brawlAPI = require('./brawlAPI');
const config = require('./config');
const { calculateMemberGrind } = require('./domain/grind');
const { mapWithConcurrency } = require('./lib/concurrency');
const { createInviteTrackerService } = require('./invite-tracker/service');
const tracker = require('./tracker');

const app = express();
const modsFile = path.join(__dirname, 'mods.json');
let botPaused = false;
let botReady = false;

app.get('/', (req, res) => {
    res.status(botReady ? 200 : 503).json({
        service: 'pixelshade-bot',
        status: botReady ? 'ready' : 'starting'
    });
});

const server = app.listen(config.port, () => {
    console.log(JSON.stringify({ message: 'health server listening', port: config.port }));
});

function getMods() {
    try {
        if (!fs.existsSync(modsFile)) return [];
        return JSON.parse(fs.readFileSync(modsFile, 'utf8'));
    } catch (error) {
        console.error(JSON.stringify({ message: 'could not read moderators', error: error.message }));
        return [];
    }
}
function saveMods(mods) {
    fs.writeFileSync(modsFile, JSON.stringify(mods, null, 2));
}

function isOwner(message) {
    if (message.guild && message.guild.ownerId === message.author.id) return true;
    if (config.ownerId && message.author.id === config.ownerId) return true;
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
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Re-enabled so your commands will work!
    ],
    ws: {
        properties: {
            browser: 'Discord iOS'
        }
    }
});
const inviteTracker = createInviteTrackerService(client);

if (config.discordDebug) {
    client.on('debug', (message) => console.debug(JSON.stringify({ message: 'discord debug', detail: message })));
}

// When the client is ready, run this code (only once)
client.once('clientReady', async () => {
    try {
        await inviteTracker.initialize();
    } catch (error) {
        console.error(JSON.stringify({
            message: 'invite tracker initialization failed',
            error: error instanceof Error ? error.message : String(error)
        }));
    }
    botReady = true;
    console.log(JSON.stringify({ message: 'discord client ready', user: client.user.tag }));
});

client.on('guildMemberAdd', (member) => {
    inviteTracker.handleMemberAdd(member).catch((error) => {
        console.error(JSON.stringify({
            message: 'invite tracker join handler failed',
            error: error instanceof Error ? error.message : String(error),
            guildId: member.guild.id,
            memberId: member.id
        }));
    });
});

client.on('guildMemberRemove', (member) => {
    inviteTracker.handleMemberRemove(member).catch((error) => {
        console.error(JSON.stringify({
            message: 'invite tracker leave handler failed',
            error: error instanceof Error ? error.message : String(error),
            guildId: member.guild.id,
            memberId: member.id
        }));
    });
});

client.on('inviteCreate', (invite) => inviteTracker.handleInviteCreate(invite));
client.on('inviteDelete', (invite) => inviteTracker.handleInviteDelete(invite));

// Listen for messages
client.on('messageCreate', async message => {
    // Ignore messages from bots to prevent infinite loops
    if (message.author.bot) return;

    try {

    // Brawl Stars Club Tracker Commands
    const args = message.content.trim().split(/ +/);
    const commandName = args[0].toLowerCase();

    // Owner Kill Switch Commands (Bypasses paused state)
    if (commandName === '!stop-bot') {
        if (!isOwner(message)) return message.reply('❌ Only the bot owner can use the master killswitch.');
        if (botPaused) return message.reply('⚠️ **The bot is already stopped.**');
        botPaused = true;
        return message.reply('🛑 **MASTER KILLSWITCH ENGAGED** 🛑');
    }

    if (commandName === '!start-bot') {
        if (!isOwner(message)) return message.reply('❌ Only the bot owner can use the master killswitch.');
        if (!botPaused) return message.reply('⚠️ **The bot is already running normally.**');
        botPaused = false;
        return message.reply('✅ **SYSTEM ONLINE** ✅\nBot commands and background tracking have been re-enabled.');
    }

    // IF GLOBALLY PAUSED, BLOCK ALL OTHER COMMANDS
    if (botPaused) {
        return; // Silently ignore to prevent spam
    }

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

    if (commandName === '!phelp') {
        const embed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('🤖 Pixel Shade Bot Commands')
            .setDescription('Here is a list of all available commands.')
            .addFields(
                {
                    name: '🎮 Public Commands',
                    value: '`!grind` - Show the Grind Points Leaderboard\n`!trophies` - Show the raw Trophy Gains Leaderboard\n`!invites [@user]` - Show invite statistics\n`!invite-leaderboard` - Show top inviters\n`!invite-status` - Show invite tracker status\n`!phelp` - Show this help menu'
                }
            );

        if (hasPermission(message)) {
            embed.addFields(
                {
                    name: '🛡️ Moderator Commands',
                    value: '`!start-tracking` - Start tracking all club members\n`!end-tracking` - Pause/stop tracking\n`!add-player #TAG` - Add a specific player to tracking\n`!remove-player #TAG` - Remove a player from tracking\n`!give grind <amount> #TAG` - Manually give grind points\n`!remove grind <amount> #TAG` - Manually remove grind points\n`!grind-info #TAG` - View breakdown of points/penalties for a player\n`!grind-audits` - View all players with manual points or bot penalties\n`!invite-setup [#channel]` - Configure invite logs\n`!invite-auto-expire on|off` - Toggle deletion of used invites\n`!invite-disable` - Disable invite tracking'
                }
            );
        }

        if (isOwner(message)) {
            embed.addFields(
                {
                    name: '👑 Owner Commands',
                    value: '`!add-mod @user` - Add a bot moderator\n`!remove-mod @user` - Remove a bot moderator\n`!stop-bot` - Engage the master killswitch\n`!start-bot` - Resume bot operations'
                }
            );
        }

        embed.setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    if (commandName === '!invite-setup') {
        if (!message.guild) return message.reply('❌ This command can only be used in a server.');
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');

        const channel = message.mentions.channels.first() || message.channel;
        if (
            channel.guildId !== message.guild.id
            || !channel.isTextBased()
            || channel.isThread?.()
        ) {
            return message.reply('❌ Choose a regular text channel in this server.');
        }

        const botMember = message.guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('❌ I need the **Manage Server** permission to read invite usage.');
        }

        const channelPermissions = channel.permissionsFor(botMember);
        const requiredChannelPermissions = [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks
        ];
        if (!channelPermissions?.has(requiredChannelPermissions)) {
            return message.reply('❌ I need View Channel, Send Messages, and Embed Links in that channel.');
        }

        try {
            await inviteTracker.setup(message.guild, channel.id, message.author.id);
            return message.reply(`✅ Invite tracking is enabled in **#${channel.name}**.`);
        } catch (error) {
            return message.reply(`❌ ${error.message}`);
        }
    }

    if (commandName === '!invite-disable') {
        if (!message.guild) return message.reply('❌ This command can only be used in a server.');
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');

        try {
            const disabled = await inviteTracker.disable(message.guild.id, message.author.id);
            return message.reply(disabled
                ? '✅ Invite tracking is disabled for this server.'
                : '⚠️ Invite tracking was not configured for this server.');
        } catch (error) {
            return message.reply(`❌ ${error.message}`);
        }
    }

    if (commandName === '!invite-status') {
        if (!message.guild) return message.reply('❌ This command can only be used in a server.');

        try {
            const inviteConfig = await inviteTracker.getConfig(message.guild.id);
            if (!inviteConfig?.enabled) {
                return message.reply('ℹ️ Invite tracking is not enabled in this server.');
            }
            const channel = message.guild.channels.cache.get(inviteConfig.channel_id);
            const channelName = channel?.name ? `#${channel.name}` : 'the configured channel';
            const autoExpire = inviteConfig.auto_expire_invites ? 'on' : 'off';
            return message.reply(
                `✅ Invite tracking is enabled in **${channelName}**. Auto-expire is **${autoExpire}**.`
            );
        } catch (error) {
            return message.reply(`❌ ${error.message}`);
        }
    }

    if (commandName === '!invite-auto-expire') {
        if (!message.guild) return message.reply('❌ This command can only be used in a server.');
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');

        const setting = args[1]?.toLowerCase();
        if (setting !== 'on' && setting !== 'off') {
            return message.reply('❌ Use `!invite-auto-expire on` or `!invite-auto-expire off`.');
        }

        try {
            const enabled = setting === 'on';
            await inviteTracker.setAutoExpire(message.guild.id, enabled, message.author.id);
            return message.reply(`✅ Invite auto-expire is now **${enabled ? 'on' : 'off'}**.`);
        } catch (error) {
            return message.reply(`❌ ${error.message}`);
        }
    }

    if (commandName === '!invites') {
        if (!message.guild) return message.reply('❌ This command can only be used in a server.');
        const target = message.mentions.users.first() || message.author;

        try {
            const stats = await inviteTracker.getStats(message.guild.id, target.id);
            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`Invite statistics for ${target.username}`)
                .addFields(
                    { name: 'Net invites', value: String(stats.netInvites), inline: true },
                    { name: 'Joined', value: String(stats.totalInvites), inline: true },
                    { name: 'Left', value: String(stats.leftMembers), inline: true }
                )
                .setFooter({ text: 'Invite links are never shown.' })
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        } catch (error) {
            return message.reply(`❌ ${error.message}`);
        }
    }

    if (commandName === '!invite-leaderboard') {
        if (!message.guild) return message.reply('❌ This command can only be used in a server.');

        try {
            const leaderboard = await inviteTracker.getLeaderboard(message.guild.id, 10);
            const description = leaderboard.length > 0
                ? leaderboard.map((entry, index) => (
                    `**${index + 1}.** <@${entry.inviterId}> — **${entry.netInvites}** net `
                    + `(${entry.totalInvites} joined, ${entry.leftMembers} left)`
                )).join('\n')
                : 'No credited invites have been recorded yet.';
            const embed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('🏆 Invite leaderboard')
                .setDescription(description)
                .setFooter({ text: 'Invite links are never shown.' })
                .setTimestamp();
            return message.reply({
                allowedMentions: { parse: [] },
                embeds: [embed]
            });
        } catch (error) {
            return message.reply(`❌ ${error.message}`);
        }
    }

    if (commandName === '!start-tracking') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        const clubTag = config.clubTag;

        try {
            message.reply('⏳ Fetching full profiles for all club members (this takes a few seconds)...');
            const clubMembers = await brawlAPI.getClubMembers(clubTag);

            const fullProfiles = await mapWithConcurrency(
                clubMembers,
                5,
                (member) => brawlAPI.getPlayer(member.tag)
            );

            const validProfiles = fullProfiles.filter(p => p !== null);

            await tracker.startTracking(validProfiles);
            message.reply(`✅ Started tracking **${validProfiles.length}** members from club **${clubTag}**!`);
        } catch (error) {
            message.reply(`❌ ${error.message}`);
        }
        return;
    }

    if (commandName === '!add-player') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        if (!args[1]) return message.reply('❌ Please provide a player tag. Example: `!add-player #TAG`');
        
        let tag = args[1].toUpperCase();
        if (!tag.startsWith('#')) tag = '#' + tag;

        try {
            const currentData = await tracker.getTrackingData();
            if (!currentData.isTracking) {
                return message.reply('❌ Tracking has not been started. Use `!start-tracking` first.');
            }

            if (currentData.members.some(m => m.tag === tag)) {
                return message.reply(`⚠️ Player **${tag}** is already being tracked.`);
            }

            const waitMsg = await message.reply(`⏳ Fetching profile for **${tag}**...`);
            const playerProfile = await brawlAPI.getPlayer(tag);
            
            if (!playerProfile) {
                return waitMsg.edit(`❌ Could not fetch profile for **${tag}**. Make sure the tag is correct.`);
            }

            await tracker.addPlayer(playerProfile);
            await waitMsg.edit(`✅ Added **${playerProfile.name}** (${tag}) to the tracking database!`);
        } catch (error) {
            message.reply(`❌ ${error.message}`);
        }
        return;
    }

    if (commandName === '!remove-player') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        if (!args[1]) return message.reply('❌ Please provide a player tag. Example: `!remove-player #TAG`');
        
        let tag = args[1].toUpperCase();
        if (!tag.startsWith('#')) tag = '#' + tag;

        try {
            const currentData = await tracker.getTrackingData();
            if (!currentData.isTracking) {
                return message.reply('❌ Tracking has not been started. Use `!start-tracking` first.');
            }

            if (!currentData.members.some((member) => member.tag === tag)) {
                return message.reply(`⚠️ Player **${tag}** is not currently being tracked.`);
            }

            const waitMsg = await message.reply(`⏳ Fetching profile for **${tag}**...`);
            const playerProfile = await brawlAPI.getPlayer(tag);
            if (!playerProfile) {
                return waitMsg.edit(`❌ Could not fetch profile for **${tag}**. Nothing was removed.`);
            }

            await tracker.removePlayer(tag);
            await waitMsg.edit(`✅ Removed **${playerProfile.name}** (${tag}) from the tracking database.`);
        } catch (error) {
            message.reply(`❌ ${error.message}`);
        }
        return;
    }

    if (commandName === '!give' && args[1] && args[1].toLowerCase() === 'grind') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        const amount = parseInt(args[2]);
        if (isNaN(amount) || amount <= 0) return message.reply('❌ Please provide a valid positive amount. Example: `!give grind 400 #TAG`');
        let tag = args[3];
        if (!tag) return message.reply('❌ Please provide a player tag. Example: `!give grind 400 #TAG`');
        tag = tag.toUpperCase();
        if (!tag.startsWith('#')) tag = '#' + tag;

        try {
            const newAdj = await tracker.adjustGrind(tag, amount);
            message.reply(`✅ Gave **${amount}** grind points to **${tag}**. (Total manual adjustment is now: ${newAdj})`);
        } catch (error) {
            message.reply(`❌ ${error.message}`);
        }
        return;
    }

    if (commandName === '!remove' && args[1] && args[1].toLowerCase() === 'grind') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        const amount = parseInt(args[2]);
        if (isNaN(amount) || amount <= 0) return message.reply('❌ Please provide a valid positive amount. Example: `!remove grind 400 #TAG`');
        let tag = args[3];
        if (!tag) return message.reply('❌ Please provide a player tag. Example: `!remove grind 400 #TAG`');
        tag = tag.toUpperCase();
        if (!tag.startsWith('#')) tag = '#' + tag;

        try {
            const newAdj = await tracker.adjustGrind(tag, -amount);
            message.reply(`✅ Removed **${amount}** grind points from **${tag}**. (Total manual adjustment is now: ${newAdj})`);
        } catch (error) {
            message.reply(`❌ ${error.message}`);
        }
        return;
    }

    if (commandName === '!grind-info') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        if (!args[1]) return message.reply('❌ Please provide a player tag. Example: `!grind-info #TAG`');
        let tag = args[1].toUpperCase();
        if (!tag.startsWith('#')) tag = '#' + tag;

        try {
            const data = await tracker.getTrackingData();
            if (!data.isTracking) {
                return message.reply('❌ Tracking has not been started. Use `!start-tracking` first.');
            }

            const baseline = data.members.find(m => m.tag === tag);
            if (!baseline) {
                return message.reply(`❌ Player **${tag}** is not currently in the tracking database.`);
            }

            const waitMsg = await message.reply(`⏳ Fetching breakdown for **${tag}**...`);
            const currentMember = await brawlAPI.getPlayer(tag);

            if (!currentMember || !currentMember.brawlers) {
                return waitMsg.edit(`❌ Could not fetch live data for **${tag}**.`);
            }

            const grind = calculateMemberGrind(baseline, currentMember);

            const embed = new EmbedBuilder()
                .setColor('#00FFFF')
                .setTitle(`📊 Grind Info: ${currentMember.name}`)
                .setDescription(`Detailed breakdown of Grind Points for \`${tag}\``)
                .addFields(
                    { name: 'Raw Base Points', value: `\`+${Math.floor(grind.basePoints)}\``, inline: true },
                    { name: 'Bot Penalties', value: grind.botPenalties > 0 ? `\`-${grind.botPenalties}\`` : '\`0\`', inline: true },
                    { name: 'Manual Adjustments', value: grind.manualAdjustment !== 0 ? (grind.manualAdjustment > 0 ? `\`+${grind.manualAdjustment}\`` : `\`${grind.manualAdjustment}\``) : '\`0\`', inline: true },
                    { name: 'Final Grind Points', value: `**${grind.total}**`, inline: false }
                )
                .setTimestamp();

            await waitMsg.edit({ content: null, embeds: [embed] });

        } catch (error) {
            message.reply(`❌ ${error.message}`);
        }
        return;
    }

    if (commandName === '!grind-audits' || commandName === '!grind-logs' || commandName === '!grind-adjustments') {
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        try {
            const data = await tracker.getTrackingData();
            if (!data.isTracking) {
                return message.reply('❌ Tracking has not been started. Use `!start-tracking` first.');
            }

            let auditList = [];

            data.members.forEach(member => {
                let botPenalties = 0;
                let manualAdjustment = 0;

                if (member.brawlers) {
                    member.brawlers.forEach(brawler => {
                        if (brawler.id === -1 && brawler.grindAdjustment) {
                            manualAdjustment = brawler.grindAdjustment;
                        } else if (brawler.illegitimate) {
                            botPenalties += brawler.illegitimate;
                        }
                    });
                }

                if (botPenalties > 0 || manualAdjustment !== 0) {
                    auditList.push({
                        name: member.name,
                        tag: member.tag,
                        botPenalties,
                        manualAdjustment
                    });
                }
            });

            if (auditList.length === 0) {
                return message.reply('✅ No players have any point buffs, nerfs, or bot penalties.');
            }

            const embed = new EmbedBuilder()
                .setColor('#FF00FF')
                .setTitle('⚖️ Grind Point Adjustments')
                .setTimestamp();

            let desc = 'List of all players with modified grind points.\n\n';
            auditList.forEach(player => {
                let botStr = player.botPenalties > 0 ? `🤖 Bot Penalty: \`-${player.botPenalties}\`` : '';
                let manualStr = player.manualAdjustment !== 0 ? `🛠️ Manual: \`${player.manualAdjustment > 0 ? '+' : ''}${player.manualAdjustment}\`` : '';
                
                let details = [botStr, manualStr].filter(Boolean).join(' | ');
                desc += `**${player.name}** (\`${player.tag}\`)\n↳ ${details}\n\n`;
            });

            embed.setDescription(desc);
            await message.reply({ embeds: [embed] });

        } catch (error) {
            message.reply(`❌ ${error.message}`);
        }
        return;
    }

    if (commandName === '!trophies') {
        const data = await tracker.getTrackingData();
        if (!data.isTracking) {
            return message.reply('❌ Tracking has not been started. Use `!start-tracking` first.');
        }

        try {
            const waitMsg = await message.reply('⏳ Fetching live stats for all members (this takes a few seconds)...');

            const results = [];
            await mapWithConcurrency(data.members, 5, async (baseline) => {
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
        const data = await tracker.getTrackingData();
        if (!data.isTracking) {
            return message.reply('❌ Tracking has not been started. Use `!start-tracking` first.');
        }

        try {
            const waitMsg = await message.reply('⏳ Calculating fair Grind Scores from live API (this takes a few seconds)...');

            const results = [];

            // Re-fetch all members to compare current vs baseline Brawler stats
            await mapWithConcurrency(data.members, 5, async (baseline) => {
                const currentMember = await brawlAPI.getPlayer(baseline.tag);
                if (currentMember && currentMember.brawlers) {
                    const grind = calculateMemberGrind(baseline, currentMember);
                    results.push({
                        name: baseline.name,
                        grindPoints: grind.total,
                        rawGained: grind.rawGained
                    });
                }
            });

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
        await tracker.endTracking();
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
        if (!hasPermission(message)) return message.reply('❌ You do not have permission to use this command.');
        message.reply('Pong!');
        return;
    }

    if (commandName === 'hello') {
        message.reply(`Hello there, ${message.author.username}!`);
        return;
    }
    } catch (error) {
        console.error(JSON.stringify({
            message: 'message command failed',
            command: message.content?.split(/ +/, 1)[0] || null,
            error: error instanceof Error ? error.message : String(error)
        }));
        await message.reply('❌ The command failed safely; no success was recorded.').catch(() => {});
    }
});

// Listen for button clicks (Interactions)
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (botPaused) return; // Ignore buttons if bot is stopped

    let isDeferred = false;
    try {
        const data = await tracker.getTrackingData();
        if (!data) {
            return interaction.reply({ content: '❌ Tracking data is not available.', ephemeral: true });
        }

        console.log(`[Interaction] Received button click: ${interaction.customId}`);
        try {
            await interaction.deferUpdate(); // Acknowledge the click so it doesn't fail
            console.log(`[Interaction] deferUpdate successful`);
            isDeferred = true;
        } catch (deferError) {
            console.error(`[Interaction] deferUpdate failed: ${deferError.message}`);
            // Do not return. We will try to send a new message instead of editing the old one.
        }

        if (interaction.customId === 'show_all_trophies') {
            const results = [];
            await mapWithConcurrency(data.members, 5, async (baseline) => {
                const currentMember = await brawlAPI.getPlayer(baseline.tag);
                if (currentMember) {
                    results.push({
                        name: baseline.name,
                        gained: currentMember.trophies - baseline.baselineTrophies,
                        current: currentMember.trophies
                    });
                }
            });
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
            if (isDeferred) {
                await interaction.editReply({ embeds: [embed], components: [] }).catch(e => console.error('editReply catch:', e.message));
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true }).catch(e => console.error('reply catch:', e.message));
            }
        }

        if (interaction.customId === 'show_all_grind') {
            const results = [];
            await mapWithConcurrency(data.members, 5, async (baseline) => {
                const currentMember = await brawlAPI.getPlayer(baseline.tag);
                if (currentMember && currentMember.brawlers) {
                    const grind = calculateMemberGrind(baseline, currentMember);
                    results.push({ name: baseline.name, grindPoints: grind.total });
                }
            });
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
            if (isDeferred) {
                await interaction.editReply({ embeds: [embed], components: [] }).catch(e => console.error('editReply catch:', e.message));
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true }).catch(e => console.error('reply catch:', e.message));
            }
        }

    } catch (error) {
        console.error("Interaction Error:", error);
    }
});

if (config.supabaseKeyType === 'publishable' || config.supabaseKeyType === 'legacy-anon') {
    console.warn(JSON.stringify({
        message: 'Supabase is using a publishable key; configure SUPABASE_SECRET_KEY before enabling RLS'
    }));
}

console.log(JSON.stringify({ message: 'starting Discord login' }));
client.login(config.discordToken).then(() => {
    console.log(JSON.stringify({ message: 'Discord login completed' }));
}).catch(err => {
    console.error(JSON.stringify({ message: 'Discord login failed', error: err.message }));
    server.close();
    process.exitCode = 1;
});

function shutdown(signal) {
    botReady = false;
    console.log(JSON.stringify({ message: 'shutting down', signal }));
    client.destroy();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
