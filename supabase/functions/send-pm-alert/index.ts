// Sends a web-push alert between the owner and the PM(s) on a project.
// Role-aware: an owner alerts the job's assigned PM(s); a PM (or any
// non-owner) alerts the org's owner(s). Caller must be authenticated
// (verify_jwt is on); the author is never notified of their own alert.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// Public VAPID key (matches src/lib/push.ts). Private key is the secret.
const VAPID_PUBLIC =
  'BGZzDXlsGon2q4xGsbiDnltrQyHub32o2UE63nnc67MBU8vVdvQa_MCi8826rFvDrJil5x78ty-NRm2m_VHgWOE'
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!VAPID_PRIVATE) {
    return json({ error: 'Server not configured: VAPID_PRIVATE_KEY missing' }, 500)
  }

  // VAPID "subject" is just a contact URL for the push service — not email.
  // Set per-request so a missing/invalid key can't crash function boot.
  try {
    webpush.setVapidDetails(
      'https://benchmarkpmspro.vercel.app',
      VAPID_PUBLIC,
      VAPID_PRIVATE,
    )
  } catch (e) {
    return json(
      { error: 'Invalid VAPID_PRIVATE_KEY: ' + String((e as Error)?.message ?? e) },
      500,
    )
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Identify the caller from their JWT so we can exclude them as a recipient.
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401)
  const callerId = userData.user.id

  let payloadIn: { projectId?: string; message?: string }
  try {
    payloadIn = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const projectId = payloadIn.projectId
  const message = (payloadIn.message ?? '').trim()
  if (!projectId || !message) {
    return json({ error: 'Missing projectId or message' }, 400)
  }

  // Project name (for the title) and org (to resolve owners).
  const { data: proj } = await admin
    .from('projects')
    .select('name, org_id')
    .eq('id', projectId)
    .single()
  const projectName = proj?.name ?? 'Project update'
  const orgId = proj?.org_id ?? null

  // Who is the caller in this org? Owners alert the assigned PMs; everyone
  // else (PMs) alerts the org's owners.
  const { data: member } = await admin
    .from('org_members')
    .select('role')
    .eq('user_id', callerId)
    .eq('org_id', orgId)
    .maybeSingle()
  const callerIsOwner = member?.role === 'owner'

  let recipientIds: string[] = []
  if (callerIsOwner) {
    const { data: assigns } = await admin
      .from('project_assignments')
      .select('user_id')
      .eq('project_id', projectId)
    recipientIds = (assigns ?? []).map((a) => a.user_id as string)
  } else {
    const { data: owners } = await admin
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('role', 'owner')
    recipientIds = (owners ?? []).map((o) => o.user_id as string)
  }

  const targetIds = [...new Set(recipientIds)].filter(
    (id) => id && id !== callerId,
  )
  if (targetIds.length === 0) {
    return json({
      sent: 0,
      reason: callerIsOwner
        ? 'No assigned PM to alert on this job.'
        : 'No owner to alert.',
    })
  }

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', targetIds)
  if (!subs || subs.length === 0) {
    return json({
      sent: 0,
      reason: callerIsOwner
        ? 'The PM hasn’t enabled alerts on their phone yet.'
        : 'The owner hasn’t enabled alerts on their phone yet.',
    })
  }

  const body = message.length > 160 ? message.slice(0, 157) + '…' : message
  const notification = JSON.stringify({
    title: projectName,
    body,
    url: `/project/${projectId}`,
    tag: `project-${projectId}`,
  })

  let sent = 0
  const expired: string[] = []
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          notification,
        )
        sent++
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode
        if (code === 404 || code === 410) expired.push(s.endpoint)
      }
    }),
  )

  // Drop dead subscriptions so they don't linger.
  if (expired.length > 0) {
    await admin.from('push_subscriptions').delete().in('endpoint', expired)
  }

  return json({ sent })
})
