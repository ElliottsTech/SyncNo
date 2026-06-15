'use client';
import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

const API = '/api';
const ANALYTICS_URL = 'https://syncno.elliotts.tech:3003/dashboard/api/ping';

function getOrCreateInstallId(): string {
  const key = 'syncno_install_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function shouldPingAnalytics(): boolean {
  const key = 'lastPingDate';
  const today = new Date().toISOString().split('T')[0];
  const last = localStorage.getItem(key);
  if (last !== today) {
    localStorage.setItem(key, today);
    return true;
  }
  return false;
}

function sendAnalyticsPing() {
  const installId = getOrCreateInstallId();
  console.log('Analytics ping firing', installId);
  if (!shouldPingAnalytics()) return;
  const params = new URLSearchParams({
    install_id: installId,
    ua: navigator.userAgent,
    screen: `${window.screen.width}x${window.screen.height}`,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ref: document.referrer || 'direct',
  });

  // Use sendBeacon for reliability
  fetch(`${ANALYTICS_URL}?${params.toString()}`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'text/plain' },
  }).catch(() => {});
}

function parseBrowser(ua: string) {
  if (!ua) return null;
  if (ua.includes(' Edg/')) return 'Edge';
  if (ua.includes(' Chrome/') && !ua.includes(' Chromium')) return 'Chrome';
  if (ua.includes(' Firefox/')) return 'Firefox';
  if (ua.includes(' Safari/') && !ua.includes(' Chrome')) return 'Safari';
  if (ua.includes(' MSIE') || ua.includes(' Trident/')) return 'Internet Explorer';
  return 'Other';
}

function parseOS(ua: string) {
  if (!ua) return null;
  if (ua.includes(' Mac OS')) return 'macOS';
  if (ua.includes(' Windows')) return 'Windows';
  if (ua.includes(' Linux')) return 'Linux';
  if (ua.includes(' Android')) return 'Android';
  if (ua.includes(' iOS') || ua.includes(' iPhone') || ua.includes(' iPad')) return 'iOS';
  return 'Other';
}

function parseDeviceType(ua: string) {
  if (!ua) return 'Desktop';
  if (ua.includes('Mobile') || ua.includes('Android')) return 'Mobile';
  if (ua.includes('Tablet') || ua.includes('iPad')) return 'Tablet';
  return 'Desktop';
}

export default function ActivityLogger() {
  const { data: session } = useSession() as any;
  const lastLogRef = useRef<string | null>(null);

  useEffect(() => {
    // Fire analytics ping on any login
    sendAnalyticsPing();

    const userId = session?.user?.id;
    if (userId && userId !== lastLogRef.current) {
      lastLogRef.current = userId;

      const userAgent = navigator.userAgent;
      const ipPromise = fetch('https://api.ipify.org?format=json').then(r => r.json()).catch(() => null);

      Promise.resolve(ipPromise).then(ipData => {
        fetch(`${API}/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            action: 'LOGIN',
            details: 'User logged in via Azure AD',
            ip_address: ipData?.ip || null,
            user_agent: userAgent,
            browser: parseBrowser(userAgent),
            os: parseOS(userAgent),
            device_type: parseDeviceType(userAgent),
          }),
        });
      });
    }
  }, [session]);

  return null;
}
