import { createClient } from '@supabase/supabase-js';
import { processMemberBattlelogs } from './grind-processor.js';

const LEASE_SECONDS = 300;
let warnedAboutLegacyCommit = false;

export default {
    async scheduled(controller, env, ctx) {
        validateEnvironment(env);
        ctx.waitUntil(processBattlelogs(env, controller.scheduledTime));
    }
};

function validateEnvironment(env) {
    const missing = [];
    if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!env.SUPABASE_SECRET_KEY && !env.SUPABASE_KEY) {
        missing.push('SUPABASE_SECRET_KEY or SUPABASE_KEY');
    }
    if (!env.BRAWL_STARS_TOKEN && !env.BRAWL_API_TOKEN) {
        missing.push('BRAWL_STARS_TOKEN or BRAWL_API_TOKEN');
    }
    if (missing.length > 0) throw new Error(`Missing Worker secrets: ${missing.join(', ')}`);
}

function structuredLog(level, message, fields = {}) {
    const payload = JSON.stringify({ message, ...fields });
    if (level === 'error') console.error(payload);
    else if (level === 'warn') console.warn(payload);
    else console.log(payload);
}

function createSupabaseClient(env) {
    return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY || env.SUPABASE_KEY, {
        auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false
        }
    });
}

function isUnavailableRpc(error, allowPermissionFallback = false) {
    return error?.code === 'PGRST202'
        || (allowPermissionFallback && error?.code === '42501');
}

async function acquireLease(supabase, allowPermissionFallback) {
    const owner = crypto.randomUUID();
    const { data, error } = await supabase.rpc('acquire_grind_worker_lease', {
        p_lease_seconds: LEASE_SECONDS,
        p_owner: owner
    });

    if (error && isUnavailableRpc(error, allowPermissionFallback)) {
        structuredLog('warn', 'database lease is unavailable; running in legacy single-worker mode');
        return { acquired: true, owner: null };
    }
    if (error) throw new Error(`Could not acquire Worker lease: ${error.message}`);

    return { acquired: data === true, owner };
}

async function releaseLease(supabase, owner) {
    if (!owner) return;
    const { error } = await supabase.rpc('release_grind_worker_lease', { p_owner: owner });
    if (error) {
        structuredLog('error', 'could not release database lease', { error: error.message });
    }
}

async function renewLease(supabase, owner) {
    if (!owner) return;
    const { data, error } = await supabase.rpc('acquire_grind_worker_lease', {
        p_lease_seconds: LEASE_SECONDS,
        p_owner: owner
    });
    if (error) throw new Error(`Could not renew Worker lease: ${error.message}`);
    if (data !== true) throw new Error('Worker lease was lost before member processing');
}

async function fetchBattlelogs(memberTag, token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(
            `https://bsproxy.royaleapi.dev/v1/players/${encodeURIComponent(memberTag)}/battlelog`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json'
                },
                signal: controller.signal
            }
        );

        if (!response.ok) {
            throw new Error(`Brawl API returned HTTP ${response.status}`);
        }

        const body = await response.json();
        return Array.isArray(body.items) ? body.items : [];
    } finally {
        clearTimeout(timeout);
    }
}

async function sendDiscordAlert(env, member, alert) {
    const discordToken = env.DISCORD_TOKEN?.trim();
    const alertChannelId = env.ALERT_CHANNEL_ID?.trim();
    if (!discordToken || !alertChannelId) return;

    const content = `🚨 **BOT EXPLOIT DETECTED** 🚨\nPlayer **${member.name}** (\`${member.tag}\`) was caught attempting to farm bot matches using \`${alert.brawlerName}\`!\n💥 **Stripped ${alert.gained} Grind Points** from their score!`;
    const response = await fetch(`https://discord.com/api/v10/channels/${alertChannelId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${discordToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content })
    });

    if (!response.ok) {
        throw new Error(`Discord API returned HTTP ${response.status}`);
    }
}

async function commitMemberState(supabase, env, member, result) {
    const allowPermissionFallback = !env.SUPABASE_SECRET_KEY;
    const { data: committed, error: atomicError } = await supabase.rpc(
        'commit_grind_member_state_atomic',
        {
            p_brawlers: result.brawlers,
            p_expected_cursor: result.previousCursor,
            p_new_cursor: result.lastBattleTime,
            p_tag: member.tag
        }
    );

    if (!atomicError) {
        return {
            committed: committed === true,
            cursorColumn: 'last_grind_battle_time',
            mode: 'atomic'
        };
    }
    if (!isUnavailableRpc(atomicError, allowPermissionFallback)) {
        throw new Error(`Could not commit member state atomically: ${atomicError.message}`);
    }

    if (!warnedAboutLegacyCommit) {
        warnedAboutLegacyCommit = true;
        structuredLog('warn', 'atomic member commit is unavailable; using legacy conditional update');
    }

    const hasDedicatedGrindCursor = Object.prototype.hasOwnProperty.call(
        member,
        'last_grind_battle_time'
    );
    const cursorColumn = hasDedicatedGrindCursor
        ? 'last_grind_battle_time'
        : 'last_battle_time';
    const rawPreviousCursor = hasDedicatedGrindCursor
        ? member.last_grind_battle_time
        : member.last_battle_time;
    const updates = {
        brawlers: result.brawlers,
        [cursorColumn]: result.lastBattleTime
    };
    let query = supabase
        .from('club_members')
        .update(updates)
        .eq('tag', member.tag);
    query = rawPreviousCursor === null || rawPreviousCursor === undefined
        ? query.is(cursorColumn, null)
        : query.eq(cursorColumn, rawPreviousCursor);

    const { data, error } = await query.select('tag');
    if (error) throw new Error(`Could not commit member state: ${error.message}`);
    return {
        committed: Array.isArray(data) && data.length === 1,
        cursorColumn,
        mode: 'legacy-conditional'
    };
}

async function processMember(supabase, env, member) {
    const token = env.BRAWL_STARS_TOKEN || env.BRAWL_API_TOKEN;
    const logs = await fetchBattlelogs(member.tag, token);
    const result = processMemberBattlelogs(member, logs);
    if (!result.changed) return;

    const commit = await commitMemberState(supabase, env, member, result);
    if (!commit.committed) {
        structuredLog('warn', 'member state changed concurrently; stale result was discarded', {
            memberTag: member.tag
        });
        return;
    }

    for (const alert of result.alerts) {
        try {
            await sendDiscordAlert(env, member, alert);
        } catch (error) {
            structuredLog('error', 'Discord alert failed after member state was committed', {
                error: error.message,
                memberTag: member.tag
            });
        }
    }

    structuredLog('info', 'member battlelogs processed', {
        alerts: result.alerts.length,
        commitMode: commit.mode,
        cursorColumn: commit.cursorColumn,
        firstObservation: result.firstObservation,
        memberTag: member.tag,
        processedLogs: result.processedLogs
    });
}

async function processBattlelogs(env, scheduledTime) {
    const supabase = createSupabaseClient(env);
    const { data: state, error: stateError } = await supabase
        .from('global_state')
        .select('*')
        .eq('id', 1)
        .single();

    if (stateError) throw new Error(`Could not read global state: ${stateError.message}`);
    if (!state?.is_grind_tracking) {
        structuredLog('info', 'scheduled run skipped because Grind tracking is inactive', { scheduledTime });
        return;
    }

    const lease = await acquireLease(supabase, !env.SUPABASE_SECRET_KEY);
    if (!lease.acquired) {
        structuredLog('info', 'scheduled run skipped because another Worker holds the lease', { scheduledTime });
        return;
    }

    try {
        const { data: members, error: memberError } = await supabase.from('club_members').select('*');
        if (memberError) throw new Error(`Could not read club members: ${memberError.message}`);

        for (const member of members || []) {
            await renewLease(supabase, lease.owner);
            try {
                await processMember(supabase, env, member);
            } catch (error) {
                structuredLog('error', 'member processing failed', {
                    error: error instanceof Error ? error.message : String(error),
                    memberTag: member.tag
                });
            }
        }
    } finally {
        await releaseLease(supabase, lease.owner);
    }
}
