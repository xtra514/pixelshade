import test from 'node:test';
import assert from 'node:assert/strict';
import { processMemberBattlelogs } from '../src/grind-processor.js';

function battle({ battleTime, result, trophies = 900, trophyChange, type = 'ranked' }) {
    return {
        battleTime,
        battle: {
            result,
            trophyChange,
            type,
            teams: [[{ tag: '#PLAYER', brawler: { id: 1, name: 'Shelly', trophies } }]]
        }
    };
}

test('first observation advances the cursor without processing history', () => {
    const result = processMemberBattlelogs(
        { tag: '#PLAYER', last_battle_time: null, brawlers: [] },
        [battle({ battleTime: '20260820T100000.000Z', result: 'defeat', trophyChange: -8 })]
    );

    assert.equal(result.firstObservation, true);
    assert.equal(result.processedLogs, 0);
    assert.equal(result.lastBattleTime, '20260820T100000.000Z');
    assert.equal(result.alerts.length, 0);
});

test('a reset dedicated cursor does not fall back to the legacy shared cursor', () => {
    const result = processMemberBattlelogs(
        {
            tag: '#PLAYER',
            last_grind_battle_time: null,
            last_battle_time: '20260820T090000.000Z',
            brawlers: []
        },
        [battle({ battleTime: '20260820T100000.000Z', result: 'defeat', trophyChange: -8 })]
    );

    assert.equal(result.firstObservation, true);
    assert.equal(result.previousCursor, '');
    assert.equal(result.processedLogs, 0);
});

test('two low-trophy losses arm the exploit detector', () => {
    const result = processMemberBattlelogs(
        {
            tag: '#PLAYER',
            last_battle_time: '20260820T090000.000Z',
            brawlers: []
        },
        [
            battle({ battleTime: '20260820T100000.000Z', result: 'defeat', trophyChange: -8 }),
            battle({ battleTime: '20260820T110000.000Z', result: 'defeat', trophyChange: -8 })
        ]
    );

    const state = result.brawlers.find((brawler) => brawler.id === -1);
    assert.equal(state.lossCount, 2);
    assert.equal(state.exploitArmed, true);
});

test('an armed win records one penalty and resets the detector', () => {
    const result = processMemberBattlelogs(
        {
            tag: '#PLAYER',
            last_grind_battle_time: '20260820T090000.000Z',
            last_battle_time: '20260820T120000.000Z',
            brawlers: [
                { id: 1, name: 'Shelly', trophies: 800, illegitimate: 3 },
                { id: -1, lossCount: 2, exploitArmed: true, grindAdjustment: 25 }
            ]
        },
        [battle({ battleTime: '20260820T100000.000Z', result: 'victory', trophyChange: 10 })]
    );

    const state = result.brawlers.find((brawler) => brawler.id === -1);
    const baseline = result.brawlers.find((brawler) => brawler.id === 1);
    assert.equal(result.alerts.length, 1);
    assert.equal(baseline.illegitimate, 13);
    assert.equal(state.lossCount, 0);
    assert.equal(state.exploitArmed, false);
    assert.equal(state.grindAdjustment, 25);
});

test('ignores logs at or before the Grind cursor', () => {
    const result = processMemberBattlelogs(
        {
            tag: '#PLAYER',
            last_grind_battle_time: '20260820T110000.000Z',
            brawlers: [{ id: -1, lossCount: 0, exploitArmed: false }]
        },
        [battle({ battleTime: '20260820T110000.000Z', result: 'defeat', trophyChange: -8 })]
    );

    assert.equal(result.processedLogs, 0);
    assert.equal(result.changed, false);
});
