# Supabase safety runbook

The live database currently uses a publishable key with Row Level Security disabled. Do not enable RLS until both the Discord bot and Cloudflare Worker have been switched to a backend-only Supabase secret key.

## Safe deployment order

1. Create and verify a fresh backup:

   ```powershell
   node --use-system-ca scripts/backup-supabase.cjs
   ```

2. Add `SUPABASE_SECRET_KEY` to the bot host and Worker secret store. Keep the existing `SUPABASE_KEY` temporarily as a fallback.
3. Enable the Discord **Server Members Intent** and ensure the bot has **Manage Server** before deploying invite tracking.
4. Apply `migrations/20260820183000_add_tracking_safety.sql` while the existing application is still running. It only adds columns and functions and backfills the two new cursor columns from the legacy cursor.
5. Apply `migrations/20260821120000_add_invite_tracker.sql`. It creates isolated, RLS-protected invite tables and atomic accounting functions without changing Grind or Elo rows.
6. Apply `migrations/20260821153000_add_invite_auto_expire.sql`. It adds the opt-in toggle and backend-only read access needed for complete backups.
7. Deploy the application code. The new runtime prefers `SUPABASE_SECRET_KEY` and uses the atomic database functions when available.
8. Verify startup/read access, confirm the Worker reports `last_grind_battle_time` and `atomic` commit mode, then run `!invite-setup` in a test channel.
9. Apply `pending/enable_rls_after_secret_cutover.sql` only after steps 1–8 pass.
10. Confirm the bot and Worker still work, then verify a publishable key cannot access the tracking or invite tables.

The legacy `last_battle_time` column and all JSON data remain in place for rollback. Removing legacy structures requires a separate backup and explicit approval.
