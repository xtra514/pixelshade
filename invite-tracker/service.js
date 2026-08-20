const { EmbedBuilder } = require('discord.js');
const { buildAttributionQueue } = require('./domain');

function structuredLog(level, message, fields = {}) {
    const payload = JSON.stringify({ message, ...fields });
    if (level === 'error') console.error(payload);
    else if (level === 'warn') console.warn(payload);
    else console.log(payload);
}

function snapshotFromInvites(invites, vanityUses = 0) {
    return {
        invites: new Map(Array.from(invites.values(), (invite) => [
            invite.code,
            {
                inviterId: invite.inviterId || invite.inviter?.id || null,
                uses: Number.isInteger(invite.uses) ? invite.uses : 0
            }
        ])),
        vanityUses: Number.isInteger(vanityUses) ? vanityUses : null
    };
}

function createInviteTrackerService(client, suppliedStore = null) {
    const store = suppliedStore || require('./store');
    const configs = new Map();
    const guildQueues = new Map();
    const inviteSnapshots = new Map();
    const pendingAttributions = new Map();

    function cachedConfig(row) {
        return {
            autoExpireInvites: row?.auto_expire_invites === true,
            channelId: row.channel_id
        };
    }

    async function fetchSnapshot(guild) {
        const invites = await guild.invites.fetch({ cache: false });
        let vanityUses = guild.vanityURLCode ? null : 0;

        if (guild.vanityURLCode) {
            try {
                const vanity = await guild.fetchVanityData();
                vanityUses = vanity.uses;
            } catch (error) {
                structuredLog('warn', 'could not read vanity invite usage', {
                    error: error.message,
                    guildId: guild.id
                });
            }
        }

        return snapshotFromInvites(invites, vanityUses);
    }

    async function primeGuild(guild) {
        const snapshot = await fetchSnapshot(guild);
        inviteSnapshots.set(guild.id, snapshot);
        pendingAttributions.delete(guild.id);
        return snapshot.invites.size;
    }

    async function initialize() {
        const enabledConfigs = await store.listEnabledConfigs();
        for (const row of enabledConfigs) {
            configs.set(row.guild_id, cachedConfig(row));
            const guild = client.guilds.cache.get(row.guild_id);
            if (!guild) continue;

            try {
                await primeGuild(guild);
            } catch (error) {
                structuredLog('warn', 'could not initialize invite cache', {
                    error: error.message,
                    guildId: guild.id
                });
            }
        }

        structuredLog('info', 'invite tracker initialized', {
            configuredGuilds: enabledConfigs.length
        });
    }

    async function setup(guild, channelId, updatedBy) {
        let inviteCount;
        try {
            inviteCount = await primeGuild(guild);
        } catch (error) {
            structuredLog('error', 'invite tracker setup could not read invites', {
                error: error.message,
                guildId: guild.id
            });
            throw new Error('I could not read server invites. Grant me Manage Server permission and try again.');
        }

        const saved = await store.setConfig(guild.id, channelId, updatedBy);
        configs.set(guild.id, {
            autoExpireInvites: configs.get(guild.id)?.autoExpireInvites === true,
            channelId: saved.channel_id
        });
        return { inviteCount };
    }

    async function disable(guildId, updatedBy) {
        const disabled = await store.disableConfig(guildId, updatedBy);
        configs.delete(guildId);
        inviteSnapshots.delete(guildId);
        pendingAttributions.delete(guildId);
        return disabled;
    }

    async function getConfig(guildId) {
        const cached = configs.get(guildId);
        if (cached) {
            return {
                auto_expire_invites: cached.autoExpireInvites,
                channel_id: cached.channelId,
                enabled: true,
                guild_id: guildId
            };
        }
        const loaded = await store.getConfig(guildId);
        if (loaded?.enabled) configs.set(guildId, cachedConfig(loaded));
        return loaded;
    }

    async function setAutoExpire(guildId, enabled, updatedBy) {
        const saved = await store.setAutoExpire(guildId, enabled, updatedBy);
        if (!saved?.enabled) {
            throw new Error('Set up invite tracking before changing auto-expire.');
        }
        configs.set(guildId, cachedConfig(saved));
        return saved;
    }

    async function enqueueGuild(guildId, task) {
        const previous = guildQueues.get(guildId) || Promise.resolve();
        let release;
        const current = new Promise((resolve) => {
            release = resolve;
        });
        guildQueues.set(guildId, current);

        await previous.catch(() => {});
        try {
            return await task();
        } finally {
            release();
            if (guildQueues.get(guildId) === current) guildQueues.delete(guildId);
        }
    }

    async function consumeAttribution(guild) {
        const pending = pendingAttributions.get(guild.id);
        if (pending?.length) {
            const attribution = pending.shift();
            if (pending.length === 0) pendingAttributions.delete(guild.id);
            return attribution;
        }

        const previous = inviteSnapshots.get(guild.id);
        let current;
        try {
            current = await fetchSnapshot(guild);
        } catch (error) {
            structuredLog('warn', 'could not refresh invites for member join', {
                error: error.message,
                guildId: guild.id
            });
            return { inviterId: null, kind: 'unknown' };
        }

        inviteSnapshots.set(guild.id, current);
        if (!previous) return { inviterId: null, kind: 'unknown' };

        const queue = buildAttributionQueue(previous, current, { includeInviteCode: true });
        const attribution = queue.shift() || { inviterId: null, kind: 'unknown' };
        if (queue.length > 0) pendingAttributions.set(guild.id, queue);
        return attribution;
    }

    async function expireUsedInvite(guild, attribution) {
        const config = configs.get(guild.id);
        if (!config?.autoExpireInvites || !attribution.inviteCode) return;

        try {
            await guild.invites.delete(
                attribution.inviteCode,
                'Pixel Shade invite auto-expire: invite was used'
            );
            const snapshot = inviteSnapshots.get(guild.id);
            if (snapshot) {
                const invites = new Map(snapshot.invites);
                invites.delete(attribution.inviteCode);
                inviteSnapshots.set(guild.id, { ...snapshot, invites });
            }
            structuredLog('info', 'used invite expired automatically', { guildId: guild.id });
        } catch (error) {
            structuredLog('warn', 'could not auto-expire used invite', {
                error: error.message,
                guildId: guild.id
            });
        }
    }

    async function sendConfiguredEmbed(guild, embed) {
        const config = configs.get(guild.id);
        if (!config) return;

        const channel = guild.channels.cache.get(config.channelId)
            || await guild.channels.fetch(config.channelId);
        if (!channel?.isTextBased() || typeof channel.send !== 'function') {
            throw new Error('Configured invite log channel is unavailable or not text-based');
        }

        await channel.send({
            allowedMentions: { parse: [] },
            embeds: [embed]
        });
    }

    function inviterLabel(result) {
        if (result.credited && result.inviter_id) return `<@${result.inviter_id}>`;
        if (result.source_kind === 'vanity') return 'Server vanity invite (inviter unavailable)';
        if (result.inviter_id) return 'Self-invite (not credited)';
        return 'Unknown';
    }

    function addCountField(embed, result) {
        if (!result.credited || !result.inviter_id) return embed;
        return embed.addFields({
            name: 'Inviter count',
            value: `**${result.net_invites}** net (${result.total_invites} joined, ${result.left_members} left)`,
            inline: false
        });
    }

    async function handleMemberAdd(member) {
        if (member.user.bot || !configs.has(member.guild.id)) return;

        return enqueueGuild(member.guild.id, async () => {
            const attribution = await consumeAttribution(member.guild);
            await expireUsedInvite(member.guild, attribution);
            const result = await store.recordJoin({
                guildId: member.guild.id,
                inviterId: attribution.inviterId,
                joinedAt: new Date().toISOString(),
                memberId: member.id,
                sourceKind: attribution.kind
            });
            if (!result?.recorded) return;

            const embed = addCountField(
                new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('👋 Member joined')
                    .setDescription(`<@${member.id}> joined the server.`)
                    .addFields({ name: 'Invited by', value: inviterLabel(result) })
                    .setTimestamp(),
                result
            );

            try {
                await sendConfiguredEmbed(member.guild, embed);
            } catch (error) {
                structuredLog('error', 'could not send invite join log', {
                    error: error.message,
                    guildId: member.guild.id,
                    memberId: member.id
                });
            }
        });
    }

    async function handleMemberRemove(member) {
        if (member.user?.bot || !configs.has(member.guild.id)) return;

        return enqueueGuild(member.guild.id, async () => {
            const result = await store.recordLeave({
                guildId: member.guild.id,
                leftAt: new Date().toISOString(),
                memberId: member.id
            });
            if (!result?.recorded) return;

            const embed = addCountField(
                new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('👋 Member left')
                    .setDescription(`<@${member.id}> left the server.`)
                    .addFields({ name: 'Originally invited by', value: inviterLabel(result) })
                    .setTimestamp(),
                result
            );

            try {
                await sendConfiguredEmbed(member.guild, embed);
            } catch (error) {
                structuredLog('error', 'could not send invite leave log', {
                    error: error.message,
                    guildId: member.guild.id,
                    memberId: member.id
                });
            }
        });
    }

    function handleInviteCreate(invite) {
        const guildId = invite.guild?.id;
        if (!guildId || !configs.has(guildId)) return;
        const snapshot = inviteSnapshots.get(guildId);
        if (!snapshot) return;

        const invites = new Map(snapshot.invites);
        invites.set(invite.code, {
            inviterId: invite.inviterId || invite.inviter?.id || null,
            uses: Number.isInteger(invite.uses) ? invite.uses : 0
        });
        inviteSnapshots.set(guildId, { ...snapshot, invites });
    }

    function handleInviteDelete(invite) {
        const guildId = invite.guild?.id;
        if (!guildId || !configs.has(guildId)) return;
        const snapshot = inviteSnapshots.get(guildId);
        if (!snapshot) return;

        const invites = new Map(snapshot.invites);
        invites.delete(invite.code);
        inviteSnapshots.set(guildId, { ...snapshot, invites });
    }

    return {
        disable,
        getConfig,
        getLeaderboard: store.getLeaderboard,
        getStats: store.getStats,
        handleInviteCreate,
        handleInviteDelete,
        handleMemberAdd,
        handleMemberRemove,
        initialize,
        setAutoExpire,
        setup
    };
}

module.exports = { createInviteTrackerService, snapshotFromInvites };
