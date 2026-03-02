const baseline = {
    noob: { name: "NoobPlayer", trophies: 100 }, // playing a tier 1 brawler
    pro: { name: "SweatyPro", trophies: 3000 }   // playing a prestige 3 brawler
};

const current = {
    noob: { name: "NoobPlayer", trophies: 150 }, // gains 50 trophies (+50)
    pro: { name: "SweatyPro", trophies: 3002 }   // gains 2 trophies (+2)
};

function calculateGrind(baseTrophies, currentTrophies) {
    const gained = currentTrophies - baseTrophies;
    let multiplier = 1.0;

    if (currentTrophies >= 3000) multiplier = 25.0;      // Prestige 3
    else if (currentTrophies >= 2000) multiplier = 10.0; // Prestige 2
    else if (currentTrophies >= 1000) multiplier = 2.0;  // Prestige 1
    else multiplier = 1.0;                               // Normal

    return {
        gained,
        multiplier,
        grindPoints: gained * multiplier
    };
}

console.log("--- BRAWL PASS GRIND SIMULATION ---");

const noobResult = calculateGrind(baseline.noob.trophies, current.noob.trophies);
console.log(`\nPlayer: ${baseline.noob.name}`);
console.log(`Pushed Brawler from ${baseline.noob.trophies} to ${current.noob.trophies} (+${noobResult.gained} raw trophies)`);
console.log(`Since they are below 1000 trophies, they get a x${noobResult.multiplier} multiplier.`);
console.log(`Total Grind Points earned: 👉 ${noobResult.grindPoints} 👈`);

const proResult = calculateGrind(baseline.pro.trophies, current.pro.trophies);
console.log(`\nPlayer: ${baseline.pro.name}`);
console.log(`Pushed Brawler from ${baseline.pro.trophies} to ${current.pro.trophies} (+${proResult.gained} raw trophies)`);
console.log(`Since they are Prestige 3, they get a x${proResult.multiplier} multiplier!`);
console.log(`Total Grind Points earned: 👉 ${proResult.grindPoints} 👈`);
