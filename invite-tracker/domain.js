const MAX_PENDING_ATTRIBUTIONS = 100;

function asUseCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

function buildAttributionQueue(previousSnapshot, currentSnapshot, options = {}) {
    if (!previousSnapshot || !currentSnapshot) return [];

    const sources = [];
    for (const [code, currentInvite] of currentSnapshot.invites || []) {
        const previousInvite = previousSnapshot.invites?.get(code);
        const delta = asUseCount(currentInvite?.uses) - asUseCount(previousInvite?.uses);
        if (delta <= 0) continue;

        sources.push({
            code,
            count: delta,
            identity: currentInvite?.inviterId ? `user:${currentInvite.inviterId}` : 'unknown',
            inviterId: currentInvite?.inviterId || null,
            kind: currentInvite?.inviterId ? 'invite' : 'unknown'
        });
    }

    const hasComparableVanityCounts = Number.isInteger(previousSnapshot.vanityUses)
        && Number.isInteger(currentSnapshot.vanityUses);
    const vanityDelta = hasComparableVanityCounts
        ? currentSnapshot.vanityUses - previousSnapshot.vanityUses
        : 0;
    if (vanityDelta > 0) {
        sources.push({
            count: vanityDelta,
            identity: 'vanity',
            inviterId: null,
            kind: 'vanity'
        });
    }

    const totalIncrements = Math.min(
        sources.reduce((total, source) => total + source.count, 0),
        MAX_PENDING_ATTRIBUTIONS
    );
    if (totalIncrements === 0) return [];

    const identities = new Set(sources.map((source) => source.identity));
    if (identities.size !== 1) {
        return Array.from({ length: totalIncrements }, () => ({
            inviterId: null,
            kind: 'unknown'
        }));
    }

    const source = sources[0];
    const canExposeCodeInternally = options.includeInviteCode === true
        && sources.length === 1
        && source.kind === 'invite';
    return Array.from({ length: totalIncrements }, (_, index) => ({
        inviterId: source.inviterId,
        kind: source.kind,
        ...(canExposeCodeInternally && index === 0 ? { inviteCode: source.code } : {})
    }));
}

function calculateNetInvites(totalInvites, leftMembers) {
    const total = Number.isInteger(totalInvites) ? totalInvites : 0;
    const left = Number.isInteger(leftMembers) ? leftMembers : 0;
    return total - left;
}

module.exports = {
    buildAttributionQueue,
    calculateNetInvites
};
