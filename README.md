# Random Connect

Anonymous, country-preference random video chat built with React, Supabase Realtime, PostgreSQL, and WebRTC.

## Run locally

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the public Supabase URL/anon key plus production TURN credentials. Add the exact same `VITE_*` TURN values to Vercel's Production environment before deploying; Vite embeds them during the build.
3. Run [supabase/migrations/001_random_connect.sql](supabase/migrations/001_random_connect.sql) in the Supabase SQL editor.
4. In Supabase Realtime settings, enable Broadcast (and allow the `chat:*` topic pattern as appropriate for your project).
5. `npm run dev`

The browser requests camera/mic only after the user confirms 18+ and chooses **Start connecting**. STUN is bundled for development; configure TURN before any production deployment. Include TURN over UDP, TCP and TLS (`turns:`) so calls work across carrier NATs, corporate networks and firewalls. Set `VITE_ICE_TRANSPORT_POLICY=relay` briefly to verify your relay, then switch it back to `all`.

## Architecture

- `src/hooks/useMedia.ts` owns device permission, mute, camera and cleanup.
- `src/hooks/useMatchmaking.ts` calls atomic Postgres RPCs and polls only while queued.
- `src/hooks/useWebRTC.ts` carries SDP/ICE through Supabase Realtime Broadcast, with connection-state monitoring and deterministic teardown.
- The migration protects queue and session tables with RLS and exposes only narrowly scoped RPCs. Reports insert into a persisted pending moderation queue; build a staff-only review interface before launch.

## Deployment checklist

- Configure TURN with time-limited credentials and HTTPS on Vercel.
- Add a rate-limiting gateway/Edge Function in front of queue joins and reporting, and CAPTCHA or abuse checks where legally appropriate.
- Schedule `cleanup-stale-sessions` every minute with `CRON_SECRET`; Edge Function service-role credentials are server-only.
- Add privacy, community-guideline and legal pages appropriate to your jurisdiction. Country selection is a matching preference, never verified location.
