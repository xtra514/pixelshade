const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dns.setDefaultResultOrder('ipv4first');

const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

if (!process.env.SUPABASE_URL) throw new Error('Missing required environment variable: SUPABASE_URL');
if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_KEY) {
    throw new Error('Missing required environment variable: SUPABASE_SECRET_KEY or SUPABASE_KEY');
}

const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
    }
});

const tables = [
    { name: 'global_state', orderBy: 'id' },
    { name: 'club_members', orderBy: 'tag' },
    { name: 'invite_tracker_config', optional: true, orderBy: 'guild_id' },
    { name: 'invite_tracker_stats', optional: true, orderBy: 'guild_id' },
    { name: 'invite_tracker_members', optional: true, orderBy: 'guild_id' }
];

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function writeJsonExclusive(filePath, value) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { bytes: Buffer.byteLength(content), sha256: sha256(content) };
}

function writeTextExclusive(filePath, content) {
    fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { bytes: Buffer.byteLength(content), sha256: sha256(content) };
}

async function readAllRows(tableName, orderBy) {
    const pageSize = 1000;
    const rows = [];

    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .order(orderBy, { ascending: true })
            .range(offset, offset + pageSize - 1);

        if (error) {
            const wrapped = new Error(`Could not back up ${tableName}: ${error.message}`);
            wrapped.code = error.code;
            wrapped.cause = error;
            throw wrapped;
        }

        rows.push(...data);
        if (data.length < pageSize) break;
    }

    return rows;
}

async function readOpenApiSchema() {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: {
            apikey: supabaseKey,
            Accept: 'application/openapi+json'
        },
        signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
        return {
            available: false,
            httpStatus: response.status,
            schema: null
        };
    }

    return {
        available: true,
        httpStatus: response.status,
        schema: await response.json()
    };
}

function verifyBackup(dataFile, expectedCounts) {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

    for (const [tableName, expectedCount] of Object.entries(expectedCounts)) {
        const rows = parsed.tables[tableName];
        if (!Array.isArray(rows) || rows.length !== expectedCount) {
            throw new Error(`Backup verification failed for ${tableName}`);
        }
    }

    const memberTags = parsed.tables.club_members.map((member) => member.tag);
    if (new Set(memberTags).size !== memberTags.length) {
        throw new Error('Backup verification failed: duplicate club member tags detected');
    }

    const uniqueKeys = {
        invite_tracker_config: (row) => row.guild_id,
        invite_tracker_members: (row) => `${row.guild_id}:${row.member_id}`,
        invite_tracker_stats: (row) => `${row.guild_id}:${row.inviter_id}`
    };
    for (const [tableName, getKey] of Object.entries(uniqueKeys)) {
        const rows = parsed.tables[tableName];
        if (!Array.isArray(rows)) continue;
        const keys = rows.map(getKey);
        if (new Set(keys).size !== keys.length) {
            throw new Error(`Backup verification failed: duplicate keys in ${tableName}`);
        }
    }
}

async function main() {
    const createdAt = new Date();
    const timestamp = createdAt.toISOString().replace(/[:.]/g, '-');
    const backupRoot = process.argv[2]
        ? path.resolve(process.argv[2])
        : path.join(projectRoot, 'backups');
    const backupDirectory = path.join(backupRoot, `supabase-${timestamp}`);

    const tableData = {};
    const skippedTables = [];
    for (const table of tables) {
        try {
            tableData[table.name] = await readAllRows(table.name, table.orderBy);
        } catch (error) {
            const tableIsMissing = error.code === '42P01'
                || error.code === 'PGRST205'
                || error.cause?.message?.includes('Could not find the table');
            if (!table.optional || !tableIsMissing) throw error;
            skippedTables.push(table.name);
        }
    }

    const openApiResult = await readOpenApiSchema();
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const dataFile = path.join(backupDirectory, 'data.json');
    const projectSchemaReferenceFile = path.join(backupDirectory, 'project-schema-reference.sql');
    const dataStats = writeJsonExclusive(dataFile, {
        formatVersion: 1,
        createdAt: createdAt.toISOString(),
        sourceHost: new URL(supabaseUrl).host,
        tables: tableData
    });
    const localSchemaContent = fs.readFileSync(path.join(projectRoot, 'supabase_schema.sql'), 'utf8');
    const localSchemaStats = writeTextExclusive(projectSchemaReferenceFile, localSchemaContent);
    const fileStats = {
        'data.json': dataStats,
        'project-schema-reference.sql': localSchemaStats
    };

    if (openApiResult.available) {
        fileStats['openapi-schema.json'] = writeJsonExclusive(
            path.join(backupDirectory, 'openapi-schema.json'),
            openApiResult.schema
        );
    }
    const counts = Object.fromEntries(
        Object.entries(tableData).map(([tableName, rows]) => [tableName, rows.length])
    );

    verifyBackup(dataFile, counts);
    if (openApiResult.available) {
        JSON.parse(fs.readFileSync(path.join(backupDirectory, 'openapi-schema.json'), 'utf8'));
    }

    const manifest = {
        formatVersion: 1,
        createdAt: createdAt.toISOString(),
        sourceHost: new URL(supabaseUrl).host,
        verified: true,
        liveOpenApiSchema: {
            available: openApiResult.available,
            httpStatus: openApiResult.httpStatus
        },
        schemaReference: {
            source: 'repository',
            warning: 'This is a project restore reference, not proof of the live database schema.'
        },
        skippedTables,
        tables: counts,
        files: fileStats
    };
    writeJsonExclusive(path.join(backupDirectory, 'manifest.json'), manifest);

    console.log(JSON.stringify({
        backupDirectory,
        verified: true,
        liveOpenApiSchema: manifest.liveOpenApiSchema,
        skippedTables,
        tables: counts,
        files: manifest.files
    }, null, 2));
}

main().catch((error) => {
    console.error(`Backup failed: ${error.message}`);
    process.exitCode = 1;
});
