import { supabase } from './supabase'

// VAPID public key (safe to expose — it's sent to every browser that subscribes).
// The matching PRIVATE key lives only as the Supabase secret VAPID_PRIVATE_KEY.
const VAPID_PUBLIC_KEY =
  'BGZzDXlsGon2q4xGsbiDnltrQyHub32o2UE63nnc67MBU8vVdvQa_MCi8826rFvDrJil5x78ty-NRm2m_VHgWOE'

export type PushStatus =
  | 'unsupported' // device/browser can't do web push (e.g. iOS Safari not installed to home screen)
  | 'denied' // user blocked notifications
  | 'off' // supported, permission not granted / not subscribed
  | 'on' // subscribed and ready

/** Web push needs a service worker, the Push API, and the Notifications API. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    return sub ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registerSW(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js')
}

/**
 * Ask permission, subscribe this device, and save the subscription for the
 * signed-in user. Returns the resulting status. Safe to call repeatedly.
 */
export async function enablePush(userId: string): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return permission === 'denied' ? 'denied' : 'off'
  }

  const reg = await registerSW()
  await navigator.serviceWorker.ready

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    })
  }

  const json = sub.toJSON()
  const keys = json.keys ?? {}
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: keys.p256dh ?? '',
      auth: keys.auth ?? '',
      user_agent: navigator.userAgent,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error

  return 'on'
}

/** Unsubscribe this device and remove its saved subscription. */
export async function disablePush(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
  } catch {
    /* best-effort */
  }
  return 'off'
}
