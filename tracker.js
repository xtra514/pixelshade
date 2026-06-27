require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

/**
 * Loads the tracking data from Supabase
 * Returns a unified object similar to what data.json returned
 */
async function getTrackingData() {
    const { data: stateData, error: stateError } = await supabase.from('global_state').select('*').eq('id', 1).single();
    if (stateError) {
        console.error("Error fetching global_state:", stateError.message);
        return { isTracking: false, members: [] };
    }

    let members = [];
    let eloMembers = [];

    const { data: memberData, error: memberError } = await supabase.from('club_members').select('*');
    if (!memberError && memberData) {
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
    
    await supabase.from('global_state').update({
        is_grind_tracking: true,
        start_time: now
    }).eq('id', 1);

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
            brawlers: baselineBrawlers
        };
    });

    for (const batch of chunkArray(membersToInsert, 10)) {
        const { error } = await supabase.from('club_members').upsert(batch, { onConflict: 'tag' });
        if(error) console.error("Supabase upsert error:", error.message);
    }

    return await getTrackingData();
}

/**
 * Ends the tracking period
 */
async function endTracking() {
    await supabase.from('global_state').update({ is_grind_tracking: false }).eq('id', 1);
}

/**
 * Initializes Elo Tracking
 */
async function startEloTracking(currentMembers) {
    await supabase.from('global_state').update({ is_elo_tracking: true }).eq('id', 1);
    
    // Ensure all members exist in the DB without overwriting their existing Elo
    for (const member of currentMembers) {
        await supabase.from('club_members').upsert({ tag: member.tag, name: member.name }, { onConflict: 'tag', ignoreDuplicates: true });
    }

    const data = await getTrackingData();
    return data.eloMembers;
}

async function updateEloForMember(tag, newElo, newSkill, battleTime) {
    const updates = {};
    if (newElo !== null && newElo !== undefined) updates.current_elo = newElo;
    if (newSkill !== null && newSkill !== undefined) updates.current_skill = newSkill;
    if (battleTime !== null && battleTime !== undefined) updates.last_battle_time = battleTime;
    
    if (Object.keys(updates).length > 0) {
        await supabase.from('club_members').update(updates).eq('tag', tag);
        return true;
    }
    return false;
}

async function endEloTracking() {
    await supabase.from('global_state').update({ is_elo_tracking: false }).eq('id', 1);
}

async function clearTracking() {
    // Delete all rows safely by matching where tag is not null
    await supabase.from('club_members').delete().not('tag', 'is', null);
    await supabase.from('global_state').update({
        is_grind_tracking: false,
        is_elo_tracking: false,
        start_time: null
    }).eq('id', 1);
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
    clearTracking
};