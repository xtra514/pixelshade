require('dotenv').config();

function requireValue(name, fallbackName) {
    const value = process.env[name] || (fallbackName ? process.env[fallbackName] : undefined);
    if (!value || !value.trim()) {
        const suffix = fallbackName ? ` or ${fallbackName}` : '';
        throw new Error(`Missing required environment variable: ${name}${suffix}`);
    }
    return value.trim();
}

function classifySupabaseKey(key) {
    if (key.startsWith('sb_secret_')) return 'secret';
    if (key.startsWith('sb_publishable_')) return 'publishable';

    const parts = key.split('.');
    if (parts.length === 3) {
        try {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            return payload.role === 'service_role' ? 'legacy-service-role' : `legacy-${payload.role || 'jwt'}`;
        } catch {
            return 'legacy-jwt';
        }
    }

    return 'unknown';
}

const supabaseKey = requireValue('SUPABASE_SECRET_KEY', 'SUPABASE_KEY');

const config = Object.freeze({
    alertChannelId: process.env.ALERT_CHANNEL_ID?.trim() || null,
    brawlStarsToken: requireValue('BRAWL_STARS_TOKEN'),
    clubTag: requireValue('CLUB_TAG'),
    discordDebug: process.env.DISCORD_DEBUG === 'true',
    discordToken: requireValue('DISCORD_TOKEN'),
    ownerId: process.env.OWNER_ID?.trim() || null,
    port: Number.parseInt(process.env.PORT || '3000', 10),
    supabaseKey,
    supabaseKeyType: classifySupabaseKey(supabaseKey),
    supabaseUrl: requireValue('SUPABASE_URL')
});

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
}

module.exports = config;
