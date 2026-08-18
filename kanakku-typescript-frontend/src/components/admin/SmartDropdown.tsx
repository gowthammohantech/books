import { useState, useRef, useEffect, useMemo } from "react";
import { PlusCircle, X } from "lucide-react";

interface Item {
    id: string | number;
    name: string;
    subLabel?: string;
}

interface SmartDropdownProps {
    items: Item[];
    value: string;
    onChange: (value: string) => void; // called only when user types
    onSelect: (item: Item | null) => void; // called when user selects/unselects
    onAddNew?: () => void;
    placeholder?: string;
    addNewLabel?: string;
    selectedItem?: Item | null; // for showing selected item
    serverside?: boolean; // true = parent handles filtering; false = client-side filter
    disabled?: boolean;
    loading?: boolean;
}

const SmartDropdown: React.FC<SmartDropdownProps> = ({
    items,
    onChange,
    onSelect,
    onAddNew,
    placeholder,
    addNewLabel = "Add New Item",
    selectedItem,
    serverside = true,
    disabled = false,
    loading = false,
}) => {
    const [showDropdown, setShowDropdown] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    // Local input state for display only
    const [displayInput, setDisplayInput] = useState<string>(
        selectedItem?.name || ""
    );

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Sync displayInput if parent selectedItem changes
    useEffect(() => {
        setDisplayInput(selectedItem?.name || "");
    }, [selectedItem]);

    // Filter items only if serverside = false
    const filteredItems = useMemo(
        () =>
            !serverside
                ? items.filter(item =>
                    item.name.toLowerCase().includes(displayInput.toLowerCase())
                )
                : items,
        [items, displayInput, serverside]
    );

    // Clamp/reset the highlighted index whenever the filtered list changes
    // (new search results, list emptied, etc.) so activeIndex never points
    // past the end of what's actually rendered.
    useEffect(() => {
        setActiveIndex((prev) => {
            if (filteredItems.length === 0) return -1;
            if (prev >= filteredItems.length) return filteredItems.length - 1;
            return prev;
        });
    }, [filteredItems]);

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!showDropdown) return;

        if (e.key === "ArrowDown") {
            e.preventDefault(); // prevent cursor jump
            if (filteredItems.length === 0) return;
            setActiveIndex((prev) => (prev + 1) % filteredItems.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault(); // prevent cursor jump
            if (filteredItems.length === 0) return;
            setActiveIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
        } else if (e.key === "Enter" && activeIndex >= 0) {
            e.preventDefault(); // prevent form submit
            const selected = filteredItems[activeIndex];
            if (selected) {
                onSelect(selected);
                setDisplayInput(selected.name);
                setShowDropdown(false);
            }
        } else if (e.key === "Escape") {
            setShowDropdown(false);
        }
    };

    const makeUcFirst = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
    return (
        <div className="relative w-full" ref={wrapperRef}>
            <div className="relative">
                <input
                    type="text"
                    className={`p-2 h-10 mt-1 w-full pr-8 border text-gray-700 text-sm border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                    placeholder={placeholder}
                    value={makeUcFirst(displayInput)}
                    onChange={(e) => {
                        setDisplayInput(e.target.value);
                        onChange(e.target.value);
                        setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                />

                {/* Clear button inside input */}
                {selectedItem && (
                    <button
                        disabled={disabled}
                        type="button"
                        aria-label="Clear selection"
                        className={`absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-red-500 cursor-pointer ${disabled ? 'cursor-not-allowed' : ''}`}
                        onClick={() => {
                            onSelect(null);
                            setDisplayInput("");
                            onChange("");
                            setShowDropdown(false);
                        }}
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            {showDropdown && (
                <div className="absolute top-full left-0 w-full bg-white text-gray-950 border border-gray-200 z-10 rounded-md shadow-lg">
                    {/* Items section (scrollable) */}
                    <ul className="max-h-40 overflow-auto">
                        {!loading && filteredItems.length > 0 && (
                            filteredItems.map((item, index) => (
                                <li
                                    key={item.id}
                                    className={`p-2 cursor-pointer hover:bg-purple-50 ${index === activeIndex ? "bg-purple-50" : ""
                                        }`}
                                    onMouseDown={() => {
                                        onSelect(item);
                                        setDisplayInput(item.name);
                                        setShowDropdown(false);
                                    }}
                                >
                                    <div className="flex flex-col">
                                        <span className="font-medium text-sm text-gray-600">
                                            {makeUcFirst(item.name)}
                                        </span>
                                        {item.subLabel && (
                                            <span className="text-sm text-gray-500">{item.subLabel}</span>
                                        )}
                                    </div>
                                </li>
                            ))
                        )
                        }

                        {filteredItems.length === 0 && !loading && displayInput && (
                            <li className="p-2 text-center text-gray-500 text-sm">
                                No items found for "{displayInput}"
                            </li>
                        )}

                        {loading && (
                            <li className="p-2 text-center text-gray-500 text-sm">
                                Loading...
                            </li>
                        )}
                    </ul>

                    {/* Sticky Add New button */}
                    {onAddNew && (
                        <div
                            className="p-2 border-t border-gray-200 cursor-pointer 
                   hover:bg-purple-50 sticky bottom-0 bg-white"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                onAddNew();
                                setShowDropdown(false);
                            }}
                        >
                            <div className="flex items-center text-sm text-purple-600 font-medium">
                                <PlusCircle size={16} className="mr-2" />
                                {addNewLabel}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SmartDropdown;