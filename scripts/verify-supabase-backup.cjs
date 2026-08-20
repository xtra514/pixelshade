const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function main() {
    if (!process.argv[2]) {
        throw new Error('Usage: node scripts/verify-supabase-backup.cjs <backup-directory>');
    }

    const backupDirectory = path.resolve(process.argv[2]);
    const manifestPath = path.join(backupDirectory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    for (const [fileName, expected] of Object.entries(manifest.files)) {
        const content = fs.readFileSync(path.join(backupDirectory, fileName));
        if (content.length !== expected.bytes) {
            throw new Error(`${fileName} byte length does not match the manifest`);
        }
        if (sha256(content) !== expected.sha256) {
            throw new Error(`${fileName} SHA-256 does not match the manifest`);
        }
    }

    const data = JSON.parse(fs.readFileSync(path.join(backupDirectory, 'data.json'), 'utf8'));
    for (const [tableName, expectedCount] of Object.entries(manifest.tables)) {
        const rows = data.tables[tableName];
        if (!Array.isArray(rows) || rows.length !== expectedCount) {
            throw new Error(`${tableName} row count does not match the manifest`);
        }
    }

    const uniqueKeys = {
        club_members: (row) => row.tag,
        invite_tracker_config: (row) => row.guild_id,
        invite_tracker_members: (row) => `${row.guild_id}:${row.member_id}`,
        invite_tracker_stats: (row) => `${row.guild_id}:${row.inviter_id}`
    };
    for (const [tableName, getKey] of Object.entries(uniqueKeys)) {
        const rows = data.tables[tableName];
        if (!Array.isArray(rows)) continue;
        const keys = rows.map(getKey);
        if (new Set(keys).size !== keys.length) {
            throw new Error(`${tableName} contains duplicate primary keys`);
        }
    }

    console.log(JSON.stringify({
        backupDirectory,
        files: Object.keys(manifest.files).length,
        tables: manifest.tables,
        verified: true
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(`Backup verification failed: ${error.message}`);
    process.exitCode = 1;
}
