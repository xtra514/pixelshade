function findPlayerBrawler(log, memberTag) {
    const teams = log.battle?.teams;
    if (Array.isArray(teams)) {
        for (const team of teams) {
            const player = team.find((candidate) => candidate.tag === memberTag);
            if (player) return player.brawler || null;
        }
    }

    const players = log.battle?.players;
    if (Array.isArray(players)) {
        return players.find((candidate) => candidate.tag === memberTag)?.brawler || null;
    }

    return null;
}

function classifyResult(log) {
    let isLoss = log.battle?.result === 'defeat'
        || (Number.isFinite(log.battle?.trophyChange) && log.battle.trophyChange < 0);
    let isWin = log.battle?.result === 'victory'
        || (Number.isFinite(log.battle?.trophyChange) && log.battle.trophyChange > 0);

    if (Number.isFinite(log.battle?.rank)) {
        if (log.battle.mode === 'soloShowdown') {
            if (log.battle.rank > 5) isLoss = true;
            if (log.battle.rank < 5) isWin = true;
        } else if (log.battle.mode === 'duoShowdown') {
            if (log.battle.rank > 3) isLoss = true;
            if (log.battle.rank < 3) isWin = true;
        }
    }

    return { isLoss, isWin };
}

function cloneBrawlers(brawlers) {
    return Array.isArray(brawlers) ? brawlers.map((brawler) => ({ ...brawler })) : [];
}

export function processMemberBattlelogs(member, logs) {
    const sortedLogs = (Array.isArray(logs) ? logs : [])
        .filter((log) => log.battleTime)
        .sort((left, right) => left.battleTime.localeCompare(right.battleTime));
    const hasDedicatedGrindCursor = Object.prototype.hasOwnProperty.call(
        member,
        'last_grind_battle_time'
    );
    const previousCursor = hasDedicatedGrindCursor
        ? member.last_grind_battle_time || ''
        : member.last_battle_time || '';
    const brawlers = cloneBrawlers(member.brawlers);
    let state = brawlers.find((brawler) => brawler.id === -1);

    if (!state) {
        state = { id: -1, lossCount: 0, exploitArmed: false };
        brawlers.push(state);
    }

    let lossCount = Number.isInteger(state.lossCount) ? state.lossCount : 0;
    let exploitArmed = state.exploitArmed === true;
    const newestCursor = sortedLogs.at(-1)?.battleTime || previousCursor;
    const firstObservation = !previousCursor || previousCursor === '20000101T000000.000Z';
    const logsToProcess = firstObservation
        ? []
        : sortedLogs.filter((log) => log.battleTime > previousCursor);
    const alerts = [];

    for (const log of logsToProcess) {
        const myBrawler = findPlayerBrawler(log, member.tag);
        if (!myBrawler || log.battle?.type !== 'ranked') continue;

        const { isLoss, isWin } = classifyResult(log);

        if (isLoss) {
            if (myBrawler.trophies <= 1000) {
                lossCount += 1;
                if (lossCount >= 2) exploitArmed = true;
            } else if (myBrawler.trophies % 1000 !== 0) {
                lossCount = 0;
                exploitArmed = false;
            }
            continue;
        }

        if (!isWin) continue;

        if (exploitArmed && myBrawler.trophies <= 1999) {
            const gained = Number.isFinite(log.battle?.trophyChange) && log.battle.trophyChange > 0
                ? log.battle.trophyChange
                : 8;
            const baseline = brawlers.find((brawler) => brawler.id === myBrawler.id);

            if (baseline) {
                baseline.illegitimate = (baseline.illegitimate || 0) + gained;
            } else {
                brawlers.push({
                    id: myBrawler.id,
                    name: myBrawler.name,
                    trophies: myBrawler.trophies,
                    illegitimate: gained
                });
            }

            alerts.push({
                battleTime: log.battleTime,
                brawlerName: myBrawler.name,
                gained
            });
        }

        lossCount = 0;
        exploitArmed = false;
    }

    state.lossCount = lossCount;
    state.exploitArmed = exploitArmed;

    return {
        alerts,
        brawlers,
        changed: newestCursor !== previousCursor || alerts.length > 0,
        firstObservation,
        lastBattleTime: newestCursor,
        previousCursor,
        processedLogs: logsToProcess.length
    };
}
