import type { FC } from 'react';

import { useAgentPanel } from '@context/AgentPanelContext';
import AiChatPanel from './AiChatPanel';

/**
 * Mounts the Lixi panel beside the page.
 *
 * Replaces AiChatFab, which was both the launcher and the owner of the open
 * state. The launcher is now the "Lixi" pill in the top bar, so all this needs
 * to decide is whether — and how — the panel exists.
 *
 * Two behaviours, one component:
 *   lg and up   a real layout column. The point of docking is to work the page
 *               and the agent together (read a number off the invoice list, ask
 *               about it), which an overlay covering that list defeats.
 *   below lg    an overlay with a backdrop. There is not enough width for two
 *               columns, and hiding the panel outright would leave the top-bar
 *               pill pressable but inert on every phone and small tablet.
 *
 * It returns null rather than rendering a collapsed column when closed: the
 * panel mounts a chat-session fetch and a stream hook, and keeping those alive
 * behind a zero-width column costs a request per page load for a feature nobody
 * opened.
 */
const AgentDock: FC = () => {
    const { isOpen, close } = useAgentPanel();

    if (!isOpen) return null;

    return (
        <>
            <div
                className="fixed inset-0 z-40 bg-black/30 lg:hidden"
                onClick={close}
                aria-hidden="true"
            />
            <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col bg-card shadow-2xl lg:static lg:z-auto lg:h-screen lg:w-[420px] lg:shrink-0 lg:border-l lg:border-border lg:shadow-none">
                <AiChatPanel onClose={close} />
            </aside>
        </>
    );
};

export default AgentDock;
