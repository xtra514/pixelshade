const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { calculateNetInvites } = require('./domain');

const BACKEND_KEY_TYPES = new Set(['secret', 'legacy-service-role']);

const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
    }
});

function assertBackendAccess() {
    if (!BACKEND_KEY_TYPES.has(config.supabaseKeyType)) {
        throw new Error(
            'Invite tracking requires SUPABASE_SECRET_KEY and the invite-tracker migration.'
        );
    }
}

function throwDatabaseError(error, context) {
    if (!error) return;
    console.error(JSON.stringify({
        message: 'invite tracker database operation failed',
        context,
        code: error.code || null,
        error: error.message
    }));
    const wrapped = new Error(`${context}. Invite tracker storage is not ready.`);
    wrapped.cause = error;
    throw wrapped;
}

function mapStats(row, fallbackInviterId = null) {
    const totalInvites = Number(row?.total_invites) || 0;
    const leftMembers = Number(row?.left_members) || 0;
    return {
        inviterId: row?.inviter_id || fallbackInviterId,
        leftMembers,
        netInvites: calculateNetInvites(totalInvites, leftMembers),
        totalInvites
    };
}

function isMissingAutoExpireColumn(error) {
    return Boolean(error && /auto_expire_invites/i.test(error.message || ''));
}

function mapConfig(row) {
    if (!row) return row;
    return {
        ...row,
        auto_expire_invites: row.auto_expire_invites === true
    };
}

async function listEnabledConfigs() {
    assertBackendAccess();
    let { data, error } = await supabase
        .from('invite_tracker_config')
        .select('guild_id, channel_id, auto_expire_invites')
        .eq('enabled', true);
    if (isMissingAutoExpireColumn(error)) {
        ({ data, error } = await supabase
            .from('invite_tracker_config')
            .select('guild_id, channel_id')
            .eq('enabled', true));
    }
    throwDatabaseError(error, 'Could not load invite tracker configuration');
    return (data || []).map(mapConfig);
}

async function getConfig(guildId) {
    assertBackendAccess();
    let { data, error } = await supabase
        .from('invite_tracker_config')
        .select('guild_id, channel_id, enabled, auto_expire_invites')
        .eq('guild_id', guildId)
        .maybeSingle();
    if (isMissingAutoExpireColumn(error)) {
        ({ data, error } = await supabase
            .from('invite_tracker_config')
            .select('guild_id, channel_id, enabled')
            .eq('guild_id', guildId)
            .maybeSingle());
    }
    throwDatabaseError(error, 'Could not load invite tracker configuration');
    return mapConfig(data);
}

async function setConfig(guildId, channelId, updatedBy) {
    assertBackendAccess();
    const { data, error } = await supabase
        .from('invite_tracker_config')
        .upsert({
            guild_id: guildId,
            channel_id: channelId,
            enabled: true,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy
        }, { onConflict: 'guild_id' })
        .select('guild_id, channel_id, enabled')
        .single();
    throwDatabaseError(error, 'Could not save invite tracker configuration');
    return data;
}

async function disableConfig(guildId, updatedBy) {
    assertBackendAccess();
    const { data, error } = await supabase
        .from('invite_tracker_config')
        .update({
            enabled: false,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy
        })
        .eq('guild_id', guildId)
        .select('guild_id');
    throwDatabaseError(error, 'Could not disable invite tracking');
    return Array.isArray(data) && data.length === 1;
}

async function setAutoExpire(guildId, enabled, updatedBy) {
    assertBackendAccess();
    const { data, error } = await supabase
        .from('invite_tracker_config')
        .update({
            auto_expire_invites: enabled,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy
        })
        .eq('guild_id', guildId)
        .eq('enabled', true)
        .select('guild_id, channel_id, enabled, auto_expire_invites')
        .maybeSingle();
    if (isMissingAutoExpireColumn(error)) {
        throw new Error('Apply the invite auto-expire migration before enabling this feature.');
    }
    throwDatabaseError(error, 'Could not update invite auto-expire setting');
    return mapConfig(data);
}

async function recordJoin({ guildId, memberId, inviterId, sourceKind, joinedAt }) {
    assertBackendAccess();
    const { data, error } = await supabase.rpc('record_invite_join_atomic', {
        p_guild_id: guildId,
        p_inviter_id: inviterId,
        p_joined_at: joinedAt,
        p_member_id: memberId,
        p_source_kind: sourceKind
    });
    throwDatabaseError(error, 'Could not record member invite');
    return data;
}

async function recordLeave({ guildId, memberId, leftAt }) {
    assertBackendAccess();
    const { data, error } = await supabase.rpc('record_invite_leave_atomic', {
        p_guild_id: guildId,
        p_left_at: leftAt,
        p_member_id: memberId
    });
    throwDatabaseError(error, 'Could not record member departure');
    return data;
}

async function getStats(guildId, inviterId) {
    assertBackendAccess();
    const { data, error } = await supabase
        .from('invite_tracker_stats')
        .select('inviter_id, total_invites, left_members')
        .eq('guild_id', guildId)
        .eq('inviter_id', inviterId)
        .maybeSingle();
    throwDatabaseError(error, 'Could not load invite statistics');
    return mapStats(data, inviterId);
}

async function getLeaderboard(guildId, limit = 10) {
    assertBackendAccess();
    const { data, error } = await supabase
        .from('invite_tracker_stats')
        .select('inviter_id, total_invites, left_members')
        .eq('guild_id', guildId)
        .limit(1000);
    throwDatabaseError(error, 'Could not load the invite leaderboard');

    return (data || [])
        .map((row) => mapStats(row))
        .sort((left, right) => (
            right.netInvites - left.netInvites
            || right.totalInvites - left.totalInvites
            || left.inviterId.localeCompare(right.inviterId)
        ))
        .slice(0, limit);
}

module.exports = {
    disableConfig,
    getConfig,
    getLeaderboard,
    getStats,
    listEnabledConfigs,
    recordJoin,
    recordLeave,
    setAutoExpire,
    setConfig
};
