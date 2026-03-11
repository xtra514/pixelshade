const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

/**
 * Loads the tracking data from data.json
 */
function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        return { isTracking: false, members: [] };
    }
    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    try {
        return JSON.parse(rawData);
    } catch (e) {
        console.error("Error parsing data.json. Returning empty data.", e);
        return { isTracking: false, members: [] };
    }
}

/**
 * Saves tracking data to data.json
 */
function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Starts a new tracking period by saving the baseline trophies of all current members
 * We now deep clone their entire brawler roster so we can compare individual Brawler gains later.
 */
function startTracking(currentMembers) {
    const existingData = loadData();

    const trackingData = {
        ...existingData,
        isTracking: true,
        startTime: new Date().toISOString(),
        members: currentMembers.map(member => {
            // Store every single brawler's current trophies for later comparison
            const baselineBrawlers = member.brawlers ? member.brawlers.map(b => ({
                id: b.id,
                name: b.name,
                trophies: b.trophies
            })) : [];

            return {
                tag: member.tag,
                name: member.name,
                baselineTrophies: member.trophies,
                brawlers: baselineBrawlers
            };
        })
    };
    saveData(trackingData);
    return trackingData;
}

/**
 * Gets the current tracking data
 */
function getTrackingData() {
    return loadData();
}

/**
 * Ends the tracking period
 */
function endTracking() {
    const data = loadData();
    data.isTracking = false;
    saveData(data);
}

/**
 * Initializes Elo Tracking
 */
function startEloTracking(currentMembers) {
    const data = loadData();
    data.isEloTracking = true;

    // Merge or create Elo members map
    const existingEloMembers = data.eloMembers || [];

    data.eloMembers = currentMembers.map(member => {
        const existing = existingEloMembers.find(m => m.tag === member.tag);
        return {
            tag: member.tag,
            name: member.name,
            currentElo: existing ? existing.currentElo : null,
            lastBattleTime: existing ? existing.lastBattleTime : null
        };
    });

    saveData(data);
    return data.eloMembers;
}

/**
 * Updates a specific member's Elo and last Battle timestamp in the database
 */
function updateEloForMember(tag, newElo, battleTime) {
    const data = loadData();
    if (!data.eloMembers) return false;

    const memberIndex = data.eloMembers.findIndex(m => m.tag === tag);
    if (memberIndex !== -1) {
        if (newElo !== null) data.eloMembers[memberIndex].currentElo = newElo;
        if (battleTime !== null) data.eloMembers[memberIndex].lastBattleTime = battleTime;
        saveData(data);
        return true;
    }
    return false;
}

/**
 * Disables Elo Tracking
 */
function endEloTracking() {
    const data = loadData();
    data.isEloTracking = false;
    saveData(data);
}

module.exports = {
    startTracking,
    getTrackingData,
    endTracking,
    loadData,
    startEloTracking,
    updateEloForMember,
    endEloTracking
};
