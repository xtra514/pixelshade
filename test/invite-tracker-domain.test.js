const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAttributionQueue, calculateNetInvites } = require('../invite-tracker/domain');

function snapshot(invites = [], vanityUses = 0) {
    return {
        invites: new Map(invites.map((invite) => [invite.code, invite])),
        vanityUses
    };
}

test('attributes one increased invite without returning its code', () => {
    const queue = buildAttributionQueue(
        snapshot([{ code: 'private-code', inviterId: '100', uses: 2 }]),
        snapshot([{ code: 'private-code', inviterId: '100', uses: 3 }])
    );

    assert.deepEqual(queue, [{ kind: 'invite', inviterId: '100' }]);
    assert.equal(JSON.stringify(queue).includes('private-code'), false);
});

test('queues multiple joins when the same inviter usage increases more than once', () => {
    const queue = buildAttributionQueue(
        snapshot([{ code: 'one', inviterId: '100', uses: 1 }]),
        snapshot([{ code: 'one', inviterId: '100', uses: 3 }])
    );

    assert.equal(queue.length, 2);
    assert.ok(queue.every((entry) => entry.inviterId === '100'));
});

test('does not choose a code for auto-expire when multiple invite codes changed', () => {
    const queue = buildAttributionQueue(
        snapshot([
            { code: 'one', inviterId: '100', uses: 0 },
            { code: 'two', inviterId: '100', uses: 0 }
        ]),
        snapshot([
            { code: 'one', inviterId: '100', uses: 1 },
            { code: 'two', inviterId: '100', uses: 1 }
        ]),
        { includeInviteCode: true }
    );

    assert.equal(queue.length, 2);
    assert.ok(queue.every((entry) => entry.inviteCode === undefined));
});

test('marks attribution unknown when different inviters changed together', () => {
    const queue = buildAttributionQueue(
        snapshot([
            { code: 'one', inviterId: '100', uses: 1 },
            { code: 'two', inviterId: '200', uses: 1 }
        ]),
        snapshot([
            { code: 'one', inviterId: '100', uses: 2 },
            { code: 'two', inviterId: '200', uses: 2 }
        ])
    );

    assert.deepEqual(queue, [
        { kind: 'unknown', inviterId: null },
        { kind: 'unknown', inviterId: null }
    ]);
});

test('recognizes vanity joins without assigning an inviter', () => {
    const queue = buildAttributionQueue(snapshot([], 4), snapshot([], 5));
    assert.deepEqual(queue, [{ kind: 'vanity', inviterId: null }]);
});

test('does not invent vanity joins when a previous usage count was unavailable', () => {
    const queue = buildAttributionQueue(snapshot([], null), snapshot([], 50));
    assert.deepEqual(queue, []);
});

test('calculates net invites', () => {
    assert.equal(calculateNetInvites(12, 3), 9);
});
