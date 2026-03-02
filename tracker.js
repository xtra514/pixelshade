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
    const trackingData = {
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

module.exports = {
    startTracking,
    getTrackingData,
    endTracking
};
