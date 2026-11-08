// Deploy as a scheduled Edge Function. Protect the endpoint with a cron secret.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
Deno.serve(async req => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('Unauthorized', { status: 401 })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString()
  const { error } = await admin.from('matchmaking_queue').delete().eq('status', 'waiting').lt('updated_at', cutoff)
  return Response.json({ cleaned: !error, error: error?.message })
})
