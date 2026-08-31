import { Info } from 'lucide-react';

// Small banner shown on settings pages when the app runs as a public demo.
// Build-time flag (Vite): set VITE_DEMO_MODE=true to enable. Mirrors the
// backend DEMO_MODE guard, which rejects settings saves with 403.
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

const DemoBanner = () => {
  if (!DEMO_MODE) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800"
    >
      <Info className="h-4 w-4 shrink-0" />
      <span>
        <strong>Demo mode:</strong> settings are read-only here. Changes won&apos;t be saved.
      </span>
    </div>
  );
};

export default DemoBanner;
