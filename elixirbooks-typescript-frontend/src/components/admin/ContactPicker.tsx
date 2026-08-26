import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useSelector } from 'react-redux';
import type { RootState } from '@store/index';
import type { Contact } from '@models/contact';
import { useDebounce } from '@hooks/useDebounce';
import Constants from '@constants/api';
import { X, PlusCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ContactPickerProps {
    view: 'clients' | 'suppliers' | 'all-active';
    value: string | null;
    onChange: (contactId: string | null, contact: Contact | null) => void;
    error?: string;
}

const ContactPicker: React.FC<ContactPickerProps> = ({ view, value, onChange, error }) => {
    const { token } = useSelector((state: RootState) => state.auth);

    const [inputValue, setInputValue] = useState('');
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);

    // New contact modal state
    const [showNewModal, setShowNewModal] = useState(false);
    const [newOrgName, setNewOrgName] = useState('');
    const [creating, setCreating] = useState(false);

    const debouncedInput = useDebounce(inputValue, 500);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    // The dropdown is portalled to <body> (so no ancestor `overflow-hidden`
    // clips it); track the input's viewport rect to position it.
    const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);
    const updateMenuRect = useCallback(() => {
        const el = inputRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setMenuRect({ top: r.bottom, left: r.left, width: r.width });
    }, []);

    // Recompute position while the dropdown is open (on scroll/resize).
    useEffect(() => {
        if (!showDropdown) return;
        updateMenuRect();
        window.addEventListener('scroll', updateMenuRect, true);
        window.addEventListener('resize', updateMenuRect);
        return () => {
            window.removeEventListener('scroll', updateMenuRect, true);
            window.removeEventListener('resize', updateMenuRect);
        };
    }, [showDropdown, updateMenuRect]);

    // Show the PERSON name primarily (the customer/supplier), falling back to the
    // organisation only when there's no person name. Company is shown as a subtitle.
    const personLabel = (c: Contact): string => {
        const person = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
        return person || c.organisation || c.id;
    };
    const companySubtitle = (c: Contact): string => {
        const person = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
        return person && c.organisation ? c.organisation : '';
    };

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            const inWrapper = wrapperRef.current?.contains(target);
            const inMenu = menuRef.current?.contains(target);
            if (!inWrapper && !inMenu) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Fetch contacts when debounced input changes
    useEffect(() => {
        if (!token) return;
        if (!showDropdown) return;
        const fetchContacts = async () => {
            setLoading(true);
            try {
                const response = await axios.get(`${Constants.API_BASE_URL}/admin/contacts`, {
                    params: { view, q: debouncedInput, pageSize: 50 },
                    headers: { Authorization: `Bearer ${token}` },
                });
                setContacts(response.data.data ?? []);
            } catch {
                setContacts([]);
            } finally {
                setLoading(false);
            }
        };
        fetchContacts();
    }, [debouncedInput, view, token, showDropdown]);

    // Sync selectedContact when value prop changes to null
    useEffect(() => {
        if (!value) {
            setSelectedContact(null);
            setInputValue('');
        }
    }, [value]);

    // Hydrate the selected contact from the `value` prop (edit prefill). Runs when
    // value is truthy and we don't already have the matching contact loaded — so it
    // fetches once on mount/value-change and never clobbers a fresh user selection
    // (which always keeps selectedContact.id === value).
    useEffect(() => {
        if (!token) return;
        if (!value) return;
        if (selectedContact && selectedContact.id === value) return;

        let cancelled = false;
        const fetchContactById = async () => {
            try {
                const response = await axios.get(`${Constants.API_BASE_URL}/admin/contacts/${value}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const contact: Contact | null = response.data?.data ?? null;
                if (cancelled || !contact) return;
                setSelectedContact(contact);
                setInputValue(personLabel(contact));
            } catch {
                // leave the field empty if the contact can't be fetched
            }
        };
        fetchContactById();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, token]);

    const handleSelect = useCallback((contact: Contact) => {
        setSelectedContact(contact);
        setInputValue(personLabel(contact));
        setShowDropdown(false);
        setActiveIndex(-1);
        onChange(contact.id, contact);
    }, [onChange]);

    const handleClear = () => {
        setSelectedContact(null);
        setInputValue('');
        setContacts([]);
        onChange(null, null);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!showDropdown) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(prev => Math.min(prev + 1, contacts.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            const c = contacts[activeIndex];
            if (c) handleSelect(c);
        } else if (e.key === 'Escape') {
            setShowDropdown(false);
        }
    };

    const closeNewModal = () => {
        setShowNewModal(false);
        setNewOrgName('');
    };

    // This overlay is hand-rolled (not the shared <Modal>), so it needs its
    // own Escape-to-close — same target as the Cancel button.
    useEffect(() => {
        if (!showNewModal) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeNewModal();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [showNewModal]);

    const handleCreateContact = async () => {
        if (!newOrgName.trim() || !token) return;
        setCreating(true);
        try {
            const response = await axios.post(
                `${Constants.API_BASE_URL}/admin/contacts/minimal`,
                { organisation: newOrgName.trim() },
                { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
            );
            const created: Contact = response.data.data;
            setShowNewModal(false);
            setNewOrgName('');
            handleSelect(created);
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to create contact');
        } finally {
            setCreating(false);
        }
    };

    const displayName = selectedContact ? personLabel(selectedContact) : null;

    return (
        <div className="w-full relative" ref={wrapperRef}>
            {/* Search input */}
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    className={`p-2 h-10 mt-1 w-full pr-8 border text-gray-700 text-sm border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 ${error ? 'border-red-400' : ''}`}
                    placeholder={`Search ${view === 'clients' ? 'clients' : view === 'suppliers' ? 'suppliers' : 'contacts'}...`}
                    value={selectedContact ? (displayName ?? '') : inputValue}
                    onChange={(e) => {
                        if (selectedContact) {
                            // User started typing after selection — clear selection
                            setSelectedContact(null);
                            onChange(null, null);
                        }
                        setInputValue(e.target.value);
                        setShowDropdown(true);
                        setActiveIndex(-1);
                    }}
                    onFocus={() => {
                        if (!selectedContact) setShowDropdown(true);
                    }}
                    onKeyDown={handleKeyDown}
                    readOnly={!!selectedContact}
                    onClick={() => {
                        if (selectedContact) {
                            // clicking on selected — do nothing
                        }
                    }}
                />
                {selectedContact && (
                    <button
                        type="button"
                        className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-red-500"
                        onClick={handleClear}
                        aria-label="Clear selected contact"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            {/* Dropdown — portalled to <body> so no ancestor overflow-hidden clips it */}
            {showDropdown && !selectedContact && menuRect && createPortal(
                <div
                    ref={menuRef}
                    className="z-[1000] bg-white border border-gray-200 rounded-md shadow-lg"
                    style={{ position: 'fixed', top: menuRect.top + 4, left: menuRect.left, width: menuRect.width }}
                >
                    <ul className="max-h-72 overflow-y-auto overscroll-contain">
                        {loading && (
                            <li className="p-2 flex items-center gap-2 text-sm text-gray-500">
                                <Loader2 size={14} className="animate-spin" /> Loading...
                            </li>
                        )}
                        {!loading && contacts.length === 0 && (
                            <li className="p-2 text-sm text-gray-500 text-center">
                                {debouncedInput ? `No results for "${debouncedInput}"` : 'Type to search...'}
                            </li>
                        )}
                        {!loading && contacts.map((c, idx) => (
                            <li
                                key={c.id}
                                className={`p-2 cursor-pointer hover:bg-purple-50 text-sm ${idx === activeIndex ? 'bg-purple-50' : ''}`}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleSelect(c);
                                }}
                            >
                                <div className="flex flex-col">
                                    <span className="font-medium text-gray-700">{personLabel(c)}</span>
                                    {(companySubtitle(c) || c.email) && (
                                        <span className="text-xs text-gray-400">
                                            {[companySubtitle(c), c.email].filter(Boolean).join(' • ')}
                                        </span>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                    {/* New contact option */}
                    <div
                        className="p-2 border-t border-gray-200 cursor-pointer hover:bg-purple-50 sticky bottom-0 bg-white"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setShowDropdown(false);
                            setShowNewModal(true);
                        }}
                    >
                        <div className="flex items-center text-sm text-purple-600 font-medium">
                            <PlusCircle size={16} className="mr-2" />
                            New contact
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Error */}
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}

            {/* Mini contact card */}
            {selectedContact && (
                <div className="mt-2 p-2 bg-purple-50 rounded-md border border-purple-100 text-sm">
                    <p className="font-semibold text-gray-800">{personLabel(selectedContact)}</p>
                    {(companySubtitle(selectedContact) || selectedContact.email) && (
                        <p className="text-gray-500 text-xs">
                            {[companySubtitle(selectedContact), selectedContact.email].filter(Boolean).join(' • ')}
                        </p>
                    )}
                </div>
            )}

            {/* New contact modal */}
            {showNewModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="New Contact"
                        className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm mx-4"
                    >
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">New Contact</h3>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Organisation Name</label>
                        <input
                            type="text"
                            className="border border-gray-300 rounded-md px-3 py-2 w-full text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-600 mb-4"
                            placeholder="Enter organisation name"
                            value={newOrgName}
                            onChange={(e) => setNewOrgName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateContact(); } }}
                            autoFocus
                        />
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={closeNewModal}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateContact}
                                disabled={creating || !newOrgName.trim()}
                                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-60 flex items-center gap-2"
                            >
                                {creating && <Loader2 size={14} className="animate-spin" />}
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ContactPicker;
