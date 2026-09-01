/**
 * Floating co-pilot launcher (Cluster H, slice H.3).
 *
 * Bottom-right 56×56 purple-gradient button that opens the slide-in
 * AiChatPanel. Renders only when the user has AI enabled (`aiConfig.enabled`),
 * so the core product is untouched when AI is off.
 */
import { useState, type FC } from 'react';
import { Sparkles } from 'lucide-react';

import { useAiConfig } from '@hooks/useAiConfig';
import AiChatPanel from './AiChatPanel';

const AiChatFab: FC = () => {
  const { config } = useAiConfig();
  const [open, setOpen] = useState(false);

  if (!config?.enabled) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open financial co-pilot"
          title="Financial co-pilot · ≈ $0.005 / reply"
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/30 transition-transform hover:scale-105 active:scale-95"
        >
          <Sparkles size={24} />
        </button>
      )}
      <AiChatPanel isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
};

export default AiChatFab;
