const TROPHY_BRACKETS = Object.freeze([
    { max: 999, multiplier: 0.5 },
    { max: 1999, multiplier: 1 },
    { max: 2499, multiplier: 3 },
    { max: 2699, multiplier: 6 },
    { max: 2999, multiplier: 12 },
    { max: 3099, multiplier: 25 },
    { max: 3499, multiplier: 50 },
    { max: 3999, multiplier: 75 },
    { max: Number.POSITIVE_INFINITY, multiplier: 100 }
]);

const PRESTIGE_BONUSES = Object.freeze([
    { threshold: 1000, points: 100 },
    { threshold: 2000, points: 500 },
    { threshold: 3000, points: 2000 },
    { threshold: 4000, points: 10000 },
    { threshold: 5000, points: 15000 }
]);

function calculateProgressionPoints(baselineTrophies, currentTrophies) {
    if (!Number.isFinite(baselineTrophies) || !Number.isFinite(currentTrophies)) {
        throw new TypeError('Trophy values must be finite numbers');
    }
    if (currentTrophies <= baselineTrophies) return 0;

    let points = 0;
    let cursor = baselineTrophies;

    for (const bracket of TROPHY_BRACKETS) {
        if (cursor > bracket.max) continue;
        if (cursor >= currentTrophies) break;

        const bracketEnd = Math.min(currentTrophies, bracket.max + 1);
        points += (bracketEnd - cursor) * bracket.multiplier;
        cursor = bracketEnd;
    }

    for (const bonus of PRESTIGE_BONUSES) {
        if (baselineTrophies < bonus.threshold && currentTrophies >= bonus.threshold) {
            points += bonus.points;
        }
    }

    return points;
}

function getLegacyManualAdjustment(brawlers) {
    const state = Array.isArray(brawlers) ? brawlers.find((brawler) => brawler.id === -1) : null;
    return Number.isFinite(state?.grindAdjustment) ? state.grindAdjustment : 0;
}

function calculateMemberGrind(baseline, currentMember) {
    const baselineBrawlers = Array.isArray(baseline.brawlers) ? baseline.brawlers : [];
    const currentBrawlers = Array.isArray(currentMember.brawlers) ? currentMember.brawlers : [];
    const baselineById = new Map(
        baselineBrawlers
            .filter((brawler) => brawler.id !== -1)
            .map((brawler) => [brawler.id, brawler])
    );

    let basePoints = 0;
    let botPenalties = 0;

    for (const currentBrawler of currentBrawlers) {
        const baselineBrawler = baselineById.get(currentBrawler.id);
        const baselineTrophies = baselineBrawler?.trophies || 0;
        basePoints += calculateProgressionPoints(baselineTrophies, currentBrawler.trophies);
        botPenalties += Number.isFinite(baselineBrawler?.illegitimate)
            ? baselineBrawler.illegitimate
            : 0;
    }

    const manualAdjustment = Number.isFinite(baseline.manualAdjustment)
        ? baseline.manualAdjustment
        : getLegacyManualAdjustment(baselineBrawlers);
    const total = Math.floor(basePoints - botPenalties + manualAdjustment);

    return {
        basePoints,
        botPenalties,
        manualAdjustment,
        rawGained: currentMember.trophies - baseline.baselineTrophies,
        total
    };
}

module.exports = {
    PRESTIGE_BONUSES,
    TROPHY_BRACKETS,
    calculateMemberGrind,
    calculateProgressionPoints,
    getLegacyManualAdjustment
};
