const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateMemberGrind,
    calculateProgressionPoints
} = require('../domain/grind');

test('scores progress within the first trophy bracket', () => {
    assert.equal(calculateProgressionPoints(900, 910), 5);
});

test('scores progress across a bracket boundary and awards prestige once', () => {
    assert.equal(calculateProgressionPoints(990, 1010), 115);
});

test('awards every crossed prestige bonus', () => {
    assert.equal(calculateProgressionPoints(999, 5000), 194900.5);
});

test('does not award points for trophy loss', () => {
    assert.equal(calculateProgressionPoints(1200, 1190), 0);
});

test('calculates penalties and legacy manual adjustments once', () => {
    const result = calculateMemberGrind(
        {
            baselineTrophies: 900,
            brawlers: [
                { id: 1, trophies: 900, illegitimate: 4 },
                { id: -1, grindAdjustment: 10 }
            ]
        },
        {
            trophies: 920,
            brawlers: [{ id: 1, trophies: 920 }]
        }
    );

    assert.deepEqual(result, {
        basePoints: 10,
        botPenalties: 4,
        manualAdjustment: 10,
        rawGained: 20,
        total: 16
    });
});

test('prefers normalized manual adjustment when supplied', () => {
    const result = calculateMemberGrind(
        {
            baselineTrophies: 0,
            manualAdjustment: -20,
            brawlers: [{ id: -1, grindAdjustment: 500 }]
        },
        { trophies: 0, brawlers: [] }
    );

    assert.equal(result.manualAdjustment, -20);
    assert.equal(result.total, -20);
});
