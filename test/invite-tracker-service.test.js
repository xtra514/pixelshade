const test = require('node:test');
const assert = require('node:assert/strict');
const { createInviteTrackerService } = require('../invite-tracker/service');

test('join log identifies the inviter without exposing the invite code or URL', async () => {
    let currentInvites = new Map([
        ['private-code', { code: 'private-code', inviterId: 'INVITER', uses: 0 }]
    ]);
    let recordedJoin;
    let sentMessage;
    const deletedInvites = [];

    const channel = {
        isTextBased: () => true,
        send: async (message) => {
            sentMessage = message;
        }
    };
    const guild = {
        channels: {
            cache: new Map([['CHANNEL', channel]]),
            fetch: async () => channel
        },
        fetchVanityData: async () => ({ code: null, uses: 0 }),
        id: 'GUILD',
        invites: {
            delete: async (code) => {
                deletedInvites.push(code);
            },
            fetch: async () => currentInvites
        },
        vanityURLCode: null
    };
    const store = {
        disableConfig: async () => true,
        getConfig: async () => null,
        getLeaderboard: async () => [],
        getStats: async () => ({}),
        listEnabledConfigs: async () => [],
        recordJoin: async (input) => {
            recordedJoin = input;
            return {
                credited: true,
                inviter_id: input.inviterId,
                left_members: 0,
                net_invites: 1,
                recorded: true,
                source_kind: input.sourceKind,
                total_invites: 1
            };
        },
        recordLeave: async () => ({ recorded: false }),
        setAutoExpire: async (guildId, enabled) => ({
            auto_expire_invites: enabled,
            channel_id: 'CHANNEL',
            enabled: true,
            guild_id: guildId
        }),
        setConfig: async () => ({ channel_id: 'CHANNEL' })
    };
    const client = { guilds: { cache: new Map([['GUILD', guild]]) } };
    const service = createInviteTrackerService(client, store);

    await service.setup(guild, 'CHANNEL', 'ADMIN');
    currentInvites = new Map([
        ['private-code', { code: 'private-code', inviterId: 'INVITER', uses: 1 }]
    ]);
    await service.handleMemberAdd({
        guild,
        id: 'FIRST_MEMBER',
        user: { bot: false }
    });
    assert.deepEqual(deletedInvites, []);

    await service.setAutoExpire('GUILD', true, 'ADMIN');
    currentInvites = new Map([
        ['private-code', { code: 'private-code', inviterId: 'INVITER', uses: 2 }]
    ]);
    await service.handleMemberAdd({
        guild,
        id: 'SECOND_MEMBER',
        user: { bot: false }
    });

    assert.equal(recordedJoin.inviterId, 'INVITER');
    assert.equal(recordedJoin.sourceKind, 'invite');
    assert.deepEqual(deletedInvites, ['private-code']);
    const serializedMessage = JSON.stringify(sentMessage);
    assert.equal(serializedMessage.includes('private-code'), false);
    assert.equal(serializedMessage.includes('discord.gg'), false);
    assert.equal(serializedMessage.includes('INVITER'), true);
});
