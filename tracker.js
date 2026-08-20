const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
    }
});

let warnedAboutLegacyAdjustment = false;

function throwOnDatabaseError(error, context) {
    if (!error) return;
    const wrapped = new Error(`${context}: ${error.message}`);
    wrapped.cause = error;
    throw wrapped;
}

function isUnavailablePrivilegedFunction(error) {
    const publishableKeyCannotExecute = error?.code === '42501'
        && (config.supabaseKeyType === 'publishable' || config.supabaseKeyType === 'legacy-anon');
    return error?.code === 'PGRST202'
        || publishableKeyCannotExecute;
}

/**
 * Loads the tracking data from Supabase
 * Returns a unified object similar to what data.json returned
 */
async function getTrackingData() {
    const { data: stateData, error: stateError } = await supabase.from('global_state').select('*').eq('id', 1).single();
    throwOnDatabaseError(stateError, 'Could not fetch global tracking state');

    let members = [];
    let eloMembers = [];

    const { data: memberData, error: memberError } = await supabase.from('club_members').select('*');
    throwOnDatabaseError(memberError, 'Could not fetch club members');
    if (memberData) {
        if (stateData.is_grind_tracking) {
            members = memberData.map(m => ({
                tag: m.tag,
                name: m.name,
                baselineTrophies: m.baseline_trophies,
                lastBattleTime: m.last_battle_time,
                brawlers: m.brawlers || []
            }));
        }
        
        if (stateData.is_elo_tracking) {
            eloMembers = memberData.map(m => ({
                tag: m.tag,
                name: m.name,
                currentElo: m.current_elo,
                currentSkill: m.current_skill,
                lastBattleTime: m.last_battle_time
            }));
        }
    }

    return {
        isTracking: stateData.is_grind_tracking,
        startTime: stateData.start_time,
        isEloTracking: stateData.is_elo_tracking,
        members: members,
        eloMembers: eloMembers
    };
}

/**
 * Starts a new tracking period
 */
async function startTracking(currentMembers) {
    const now = new Date().toISOString();

    const membersToInsert = currentMembers.map(member => {
        const baselineBrawlers = member.brawlers ? member.brawlers.map(b => ({
            id: b.id,
            name: b.name,
            trophies: b.trophies,
            illegitimate: 0
        })) : [];

        return {
            tag: member.tag,
            name: member.name,
            baseline_trophies: member.trophies,
            brawlers: baselineBrawlers,
            last_battle_time: null
        };
    });

    const { error: atomicError } = await supabase.rpc('start_tracking_atomic', {
        p_members: membersToInsert,
        p_started_at: now
    });
    if (!atomicError) return getTrackingData();
    if (!isUnavailablePrivilegedFunction(atomicError)) {
        throwOnDatabaseError(atomicError, 'Could not start tracking atomically');
    }

    for (const batch of chunkArray(membersToInsert, 10)) {
        const { error } = await supabase.from('club_members').upsert(batch, { onConflict: 'tag' });
        throwOnDatabaseError(error, 'Could not save tracking baselines');
    }

    const { error: stateError } = await supabase.from('global_state').update({
        is_grind_tracking: true,
        start_time: now
    }).eq('id', 1);
    throwOnDatabaseError(stateError, 'Could not activate Grind tracking');

    return getTrackingData();
}

/**
 * Ends the tracking period
 */
async function endTracking() {
    const { error } = await supabase.from('global_state').update({ is_grind_tracking: false }).eq('id', 1);
    throwOnDatabaseError(error, 'Could not stop Grind tracking');
}

/**
 * Initializes Elo Tracking
 */
async function startEloTracking(currentMembers) {
    // Ensure all members exist in the DB without overwriting their existing Elo
    for (const member of currentMembers) {
        const { error } = await supabase
            .from('club_members')
            .upsert({ tag: member.tag, name: member.name }, { onConflict: 'tag', ignoreDuplicates: true });
        throwOnDatabaseError(error, `Could not save Elo member ${member.tag}`);
    }

    const { error: stateError } = await supabase.from('global_state').update({ is_elo_tracking: true }).eq('id', 1);
    throwOnDatabaseError(stateError, 'Could not activate Elo tracking');

    const data = await getTrackingData();
    return data.eloMembers;
}

async function updateEloForMember(tag, newElo, newSkill, battleTime) {
    const updates = {};
    if (newElo !== null && newElo !== undefined) updates.current_elo = newElo;
    if (newSkill !== null && newSkill !== undefined) updates.current_skill = newSkill;
    if (battleTime !== null && battleTime !== undefined) updates.last_battle_time = battleTime;
    
    if (Object.keys(updates).length > 0) {
        const { error } = await supabase.from('club_members').update(updates).eq('tag', tag);
        throwOnDatabaseError(error, `Could not update Elo for ${tag}`);
        return true;
    }
    return false;
}

async function endEloTracking() {
    const { error } = await supabase.from('global_state').update({ is_elo_tracking: false }).eq('id', 1);
    throwOnDatabaseError(error, 'Could not stop Elo tracking');
}

async function addPlayer(member) {
    const baselineBrawlers = member.brawlers ? member.brawlers.map(b => ({
        id: b.id,
        name: b.name,
        trophies: b.trophies,
        illegitimate: 0
    })) : [];

    const memberToInsert = {
        tag: member.tag,
        name: member.name,
        baseline_trophies: member.trophies,
        brawlers: baselineBrawlers,
        last_battle_time: null
    };

    const { error: atomicError } = await supabase.rpc('upsert_grind_member_atomic', {
        p_member: memberToInsert
    });
    if (!atomicError) return getTrackingData();
    if (!isUnavailablePrivilegedFunction(atomicError)) {
        throwOnDatabaseError(atomicError, `Could not add player ${member.tag} atomically`);
    }

    const { error } = await supabase.from('club_members').upsert(memberToInsert, { onConflict: 'tag' });
    throwOnDatabaseError(error, `Could not add player ${member.tag}`);
    
    return getTrackingData();
}

async function removePlayer(tag) {
    const { error } = await supabase.from('club_members').delete().eq('tag', tag);
    throwOnDatabaseError(error, `Could not remove player ${tag}`);
    
    return getTrackingData();
}

async function adjustGrind(tag, amount) {
    const { data: atomicResult, error: atomicError } = await supabase.rpc('adjust_grind_atomic', {
        p_amount: amount,
        p_tag: tag
    });

    if (!atomicError) return Number(atomicResult);
    if (!isUnavailablePrivilegedFunction(atomicError)) {
        throwOnDatabaseError(atomicError, `Could not adjust Grind points for ${tag}`);
    }

    if (!warnedAboutLegacyAdjustment) {
        warnedAboutLegacyAdjustment = true;
        console.warn(JSON.stringify({
            message: 'Atomic Grind adjustment function is not installed; using legacy read-modify-write fallback'
        }));
    }

    const { data, error } = await supabase.from('club_members').select('brawlers').eq('tag', tag).single();
    throwOnDatabaseError(error, `Could not find player ${tag}`);
    if (!data) throw new Error('Could not find player in tracking database');
    
    let brawlers = data.brawlers || [];
    let stateObj = brawlers.find(b => b.id === -1);
    if (!stateObj) {
        stateObj = { id: -1, lossCount: 0, exploitArmed: false, grindAdjustment: 0 };
        brawlers.push(stateObj);
    }
    
    stateObj.grindAdjustment = (stateObj.grindAdjustment || 0) + amount;
    
    const { error: updateError } = await supabase.from('club_members').update({ brawlers }).eq('tag', tag);
    throwOnDatabaseError(updateError, `Could not adjust Grind points for ${tag}`);
    
    return stateObj.grindAdjustment;
}

function chunkArray(array, size) {
    const chunked = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
}

module.exports = {
    startTracking,
    getTrackingData,
    endTracking,
    startEloTracking,
    updateEloForMember,
    endEloTracking,
    addPlayer,
    removePlayer,
    adjustGrind
};
