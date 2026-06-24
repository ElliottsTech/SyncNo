import { IS_DEMO } from '../app/lib/demo';

// Static banner shown on every page when demo mode is baked into the build.
// Renders server-side — no flash, no client fetch.
export default function DemoBanner() {
  if (!IS_DEMO) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: '#f59e0b',
        color: '#1f2937',
        textAlign: 'center',
        padding: '6px 12px',
        fontSize: '13px',
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      DEMO MODE — no data is persisted. Syncs and saves are simulated.
    </div>
  );
}
