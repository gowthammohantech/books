import { ChevronDown, Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import ThermalReceipt from './ThermalReceipt';
import { THERMAL_58MM, THERMAL_80MM } from './thermalPageStyle';
import type { ThermalDocType } from './thermalAdapter';

// ---------------------------------------------------------------------------
// Shared button / dropdown primitives (mirrors InvoiceActionToolbar's local
// Dropdown/MenuItem so PrintMenu looks identical in the toolbar).
// ---------------------------------------------------------------------------

const btnCls =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer ' +
    'border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 transition-colors whitespace-nowrap';

interface PrintMenuProps {
    normalPrint: () => void;
    docType: ThermalDocType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    systemSettings: any;
    documentTitle?: string;
    normalLabel?: string;
}

const PrintMenu: React.FC<PrintMenuProps> = ({
    normalPrint,
    docType,
    data,
    systemSettings,
    documentTitle = 'Document',
    normalLabel = 'Normal',
}) => {
    const [open, setOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // The width the user selected for the NEXT thermal print.
    const [selectedWidth, setSelectedWidth] = useState<80 | 58>(80);

    // A ref holding the width at the moment a thermal print was requested.
    // We store it in a ref (not state) so it is available synchronously inside
    // the useEffect without creating a stale-closure problem.
    const pendingWidthRef = useRef<80 | 58 | null>(null);

    const thermalRef = useRef<HTMLDivElement>(null);

    const thermalPrint80 = useReactToPrint({
        contentRef: thermalRef,
        documentTitle,
        pageStyle: THERMAL_80MM,
    });

    const thermalPrint58 = useReactToPrint({
        contentRef: thermalRef,
        documentTitle,
        pageStyle: THERMAL_58MM,
    });

    // Close dropdown on outside click.
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    // After selectedWidth state + the off-screen ThermalReceipt have updated,
    // fire the matching print function and clear the pending flag.
    useEffect(() => {
        if (pendingWidthRef.current === null) return;
        const w = pendingWidthRef.current;
        // Only fire when the state matches what we requested — guarantees the
        // off-screen receipt has re-rendered at the chosen width.
        if (w !== selectedWidth) return;
        pendingWidthRef.current = null;
        if (w === 58) {
            thermalPrint58();
        } else {
            thermalPrint80();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedWidth]);

    const requestThermalPrint = (w: 80 | 58) => {
        setOpen(false);
        pendingWidthRef.current = w;
        // If already at that width, the useEffect above won't re-fire on its
        // own (state didn't change), so call directly.
        if (selectedWidth === w) {
            pendingWidthRef.current = null;
            if (w === 58) {
                thermalPrint58();
            } else {
                thermalPrint80();
            }
        } else {
            setSelectedWidth(w);
        }
    };

    return (
        <>
            {/* Off-screen ThermalReceipt — always mounted, re-renders when width changes. */}
            <div aria-hidden style={{ position: 'fixed', left: '-100000px', top: 0 }}>
                <div ref={thermalRef}>
                    {data ? (
                        <ThermalReceipt
                            docType={docType}
                            data={data}
                            systemSettings={systemSettings}
                            width={selectedWidth}
                        />
                    ) : null}
                </div>
            </div>

            {/* Print dropdown */}
            <div className="relative" ref={dropdownRef}>
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    className={btnCls}
                    aria-label="Print options"
                    aria-haspopup="menu"
                    aria-expanded={open}
                >
                    <Printer size={15} />
                    Print
                    <ChevronDown size={14} />
                </button>

                {open && (
                    <div
                        className="absolute z-30 mt-1 min-w-[180px] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                        onClick={() => setOpen(false)}
                    >
                        {/* Normal (A4) */}
                        <button
                            type="button"
                            onClick={() => { setOpen(false); normalPrint(); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                        >
                            <Printer size={14} />
                            {normalLabel}
                        </button>

                        {/* Thermal 80 mm */}
                        <button
                            type="button"
                            onClick={() => requestThermalPrint(80)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                        >
                            <Printer size={14} />
                            Thermal — 80mm
                        </button>

                        {/* Thermal 58 mm */}
                        <button
                            type="button"
                            onClick={() => requestThermalPrint(58)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                        >
                            <Printer size={14} />
                            Thermal — 58mm
                        </button>
                    </div>
                )}
            </div>
        </>
    );
};

export default PrintMenu;
