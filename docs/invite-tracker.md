# Invite tracker

The invite tracker records who invited a joining member, maintains net invite counts, and posts join/leave embeds to one configured text channel per Discord server.

Invite codes and invite URLs are never stored in Supabase and never included in channel messages. Codes exist only in the bot's in-memory Discord invite snapshot while it compares usage counts.

## Commands

- `!invite-setup` — use the current channel for invite logs.
- `!invite-setup #channel` — use the mentioned text channel for invite logs.
- `!invite-disable` — stop invite tracking for the server.
- `!invite-status` — show the configured log channel.
- `!invite-auto-expire on|off` — toggle deletion of an unambiguously used invite.
- `!invites` or `!invites @user` — show net, joined, and left counts.
- `!invite-leaderboard` — show the top ten inviters.

Setup, auto-expire, and disable commands require a Pixel Shade bot moderator or owner. Count and leaderboard commands are public.

## Discord requirements

Before deploying this code:

1. Enable the **Server Members Intent** for the bot in the Discord Developer Portal.
2. Grant the bot **Manage Server** so it can fetch invite usage metadata.
3. In the selected log channel, grant **View Channel**, **Send Messages**, and **Embed Links**.

Invite attribution is best-effort because Discord sends the member-join event separately from invite usage. A vanity invite, an expired/deleted invite, a missing permission, or multiple different invites used before the cache refresh can be reported as `Unknown` instead of guessing incorrectly.

Auto-expire defaults to off. When enabled, the bot deletes an invite only when exactly one invite code has an observable usage increase. Ambiguous, vanity, already-expired, or unavailable invites are left unchanged. Deletion failure never blocks join accounting or the welcome message. Invite codes remain memory-only and are not included in logs or database rows.

Counts begin when invite tracking is configured; historical invites are not backfilled.

## Database requirement

Configure `SUPABASE_SECRET_KEY`, then apply:

```text
supabase/migrations/20260821120000_add_invite_tracker.sql
supabase/migrations/20260821153000_add_invite_auto_expire.sql
```

The migration creates isolated invite-tracker tables with Row Level Security enabled and atomic join/leave accounting functions. It does not modify Grind or Elo rows.
