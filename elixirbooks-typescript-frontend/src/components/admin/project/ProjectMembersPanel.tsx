import { useCallback, useEffect, useState } from "react";
import axios, { AxiosError } from "axios";
import { toast } from "sonner";
import { useSelector } from "react-redux";
import { Trash2, Plus } from "lucide-react";
import type { RootState } from "../../../store";
import Constants from "../../../constants/api";
import Modal from "../Modal";
import DateInput from "../DateInput";
import SearchableDropdown from "../SearchableDropdown";
import LoaderSpinner from "../LoaderSpinner";
import { Button, Card, Badge } from "@components/ui";
import { useCurrencies } from "@hooks/useCurrencies";
import type { ProjectMember, ProjectMemberRole } from "@models/timeTracking";

interface ProjectMembersPanelProps {
    projectId: string;
    open: boolean;
    onClose: () => void;
}

interface StaffUser {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}

interface CustomerOption {
    id: string;
    name: string;
}

const ROLE_OPTIONS: ProjectMemberRole[] = ["MEMBER", "MANAGER"];

const fullName = (m: ProjectMember): string => {
    const { firstName, lastName, email } = m.employee || {};
    const name = `${firstName ?? ""} ${lastName ?? ""}`.trim();
    return name || email || m.employeeUserId;
};

/** Extract a human-readable server error message from an axios error. */
const serverMessage = (error: unknown, fallback: string): string => {
    const ax = error as AxiosError<{ message?: string; error?: string }>;
    return ax.response?.data?.message || ax.response?.data?.error || fallback;
};

/** Convert an ISO/Date-ish value to a Date for the picker (null-safe). */
const toDate = (v: string | null | undefined): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
};

/** Convert a Date to a UTC date-only ISO string (yyyy-mm-dd) for the API. */
const toDateOnly = (d: Date | null): string | null => {
    if (!d) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
};

const ProjectMembersPanel: React.FC<ProjectMembersPanelProps> = ({ projectId, open, onClose }) => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { formatMoney, defaultCurrencyCode } = useCurrencies();
    const authHeaders = { Authorization: `Bearer ${token}` };

    // --- Billing settings state ---
    const [billingRate, setBillingRate] = useState<string>("");
    const [startDate, setStartDate] = useState<Date | null>(null);
    const [endDate, setEndDate] = useState<Date | null>(null);
    const [customer, setCustomer] = useState<CustomerOption | null>(null);
    const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
    const [customerSearch, setCustomerSearch] = useState<string>("");
    const [savingSettings, setSavingSettings] = useState(false);

    // --- Members state ---
    const [members, setMembers] = useState<ProjectMember[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [staff, setStaff] = useState<StaffUser[]>([]);

    // Add-member form
    const [newEmployeeId, setNewEmployeeId] = useState<string>("");
    const [newRole, setNewRole] = useState<ProjectMemberRole>("MEMBER");
    const [newRate, setNewRate] = useState<string>("");
    const [addingMember, setAddingMember] = useState(false);

    // Per-row busy id
    const [rowBusyId, setRowBusyId] = useState<string | null>(null);

    const fetchSettings = useCallback(async () => {
        try {
            const res = await axios.get(`${Constants.FETCH_PROJECTS_URL}/${projectId}`, { headers: authHeaders });
            const p = res.data?.data ?? {};
            setBillingRate(p.billingRate != null ? String(p.billingRate) : "");
            setStartDate(toDate(p.startDate));
            setEndDate(toDate(p.endDate));
            if (p.contactId) {
                setCustomer({ id: p.contactId, name: p.contact?.name ?? p.contactName ?? "Selected customer" });
            } else {
                setCustomer(null);
            }
        } catch {
            // Non-fatal: the project may not expose settings via GET; leave fields blank.
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, token]);

    const fetchMembers = useCallback(async () => {
        try {
            setLoadingMembers(true);
            const res = await axios.get(Constants.PROJECT_MEMBERS_URL(projectId), { headers: authHeaders });
            setMembers(res.data?.data?.members ?? []);
        } catch (error) {
            toast.error(serverMessage(error, "Failed to load project members."));
        } finally {
            setLoadingMembers(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, token]);

    const fetchStaff = useCallback(async () => {
        try {
            const res = await axios.get(Constants.FETCH_STAFF_FOR_LIST_URL, {
                params: { user_type: 3, limit: 200, page: 1 },
                headers: authHeaders,
            });
            setStaff((res.data?.data?.users ?? []) as StaffUser[]);
        } catch {
            // silently ignore — add-member dropdown just stays empty
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    // Debounced customer search
    useEffect(() => {
        if (!open) return;
        const handle = setTimeout(async () => {
            try {
                const res = await axios.get(Constants.GET_CUSTOMERS_WITH_SEARCH_URL, {
                    params: { search: customerSearch, limit: 100, page: 1 },
                    headers: authHeaders,
                });
                setCustomerOptions(res.data?.data?.customers ?? []);
            } catch {
                // ignore
            }
        }, 300);
        return () => clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customerSearch, open, token]);

    useEffect(() => {
        if (!open) return;
        fetchSettings();
        fetchMembers();
        fetchStaff();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, projectId]);

    const handleSaveSettings = async () => {
        if (billingRate !== "" && isNaN(Number(billingRate))) {
            toast.error("Default billing rate must be a number.");
            return;
        }
        try {
            setSavingSettings(true);
            const payload = {
                billingRate: billingRate === "" ? null : Number(billingRate),
                startDate: toDateOnly(startDate),
                endDate: toDateOnly(endDate),
                contactId: customer?.id ?? null,
            };
            await axios.put(Constants.PROJECT_SETTINGS_URL(projectId), payload, { headers: authHeaders });
            toast.success("Project billing settings saved.");
        } catch (error) {
            toast.error(serverMessage(error, "Failed to save billing settings."));
        } finally {
            setSavingSettings(false);
        }
    };

    const handleAddMember = async () => {
        if (!newEmployeeId) {
            toast.error("Select an employee to add.");
            return;
        }
        if (newRate !== "" && isNaN(Number(newRate))) {
            toast.error("Billing rate must be a number.");
            return;
        }
        try {
            setAddingMember(true);
            const payload = {
                employeeUserId: newEmployeeId,
                role: newRole,
                billingRate: newRate === "" ? null : Number(newRate),
            };
            await axios.post(Constants.PROJECT_MEMBERS_URL(projectId), payload, { headers: authHeaders });
            toast.success("Member added.");
            setNewEmployeeId("");
            setNewRole("MEMBER");
            setNewRate("");
            fetchMembers();
        } catch (error) {
            toast.error(serverMessage(error, "Failed to add member."));
        } finally {
            setAddingMember(false);
        }
    };

    const patchMember = async (member: ProjectMember, changes: Partial<Pick<ProjectMember, "role" | "billingRate" | "isActive">>) => {
        try {
            setRowBusyId(member.id);
            const payload = {
                role: changes.role ?? member.role,
                billingRate: changes.billingRate !== undefined ? changes.billingRate : member.billingRate,
                isActive: changes.isActive !== undefined ? changes.isActive : member.isActive,
            };
            await axios.put(Constants.PROJECT_MEMBER_URL(projectId, member.id), payload, { headers: authHeaders });
            setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, ...payload } : m)));
        } catch (error) {
            toast.error(serverMessage(error, "Failed to update member."));
        } finally {
            setRowBusyId(null);
        }
    };

    const removeMember = async (member: ProjectMember) => {
        try {
            setRowBusyId(member.id);
            await axios.delete(Constants.PROJECT_MEMBER_URL(projectId, member.id), { headers: authHeaders });
            toast.success("Member removed.");
            setMembers((prev) => prev.filter((m) => m.id !== member.id));
        } catch (error) {
            toast.error(serverMessage(error, "Failed to remove member."));
        } finally {
            setRowBusyId(null);
        }
    };

    const staffOptions: CustomerOption[] = staff.map((s) => ({
        id: s.id,
        name: `${s.firstName} ${s.lastName}`.trim() || s.email,
    }));

    return (
        <Modal isOpen={open} onClose={onClose} title="Members & Billing" size="3xl">
            <div className="space-y-6">
                {/* Billing settings */}
                <Card title="Project billing settings">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Default billing rate
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={billingRate}
                                onChange={(e) => setBillingRate(e.target.value)}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
                            />
                        </div>
                        <div>
                            <SearchableDropdown
                                label="Customer"
                                noAsterisk
                                value={customer}
                                options={customerOptions}
                                inputValue={customerSearch}
                                onInputChange={(_, v) => setCustomerSearch(v)}
                                onChange={(_, v) => setCustomer(v)}
                                placeholder="Search customer..."
                            />
                        </div>
                        <DateInput label="Start date" value={startDate} onChange={setStartDate} />
                        <DateInput label="End date" value={endDate} onChange={setEndDate} minDate={startDate ?? undefined} />
                    </div>
                    <div className="flex justify-end pt-4">
                        <Button onClick={handleSaveSettings} isLoading={savingSettings} disabled={savingSettings}>
                            Save settings
                        </Button>
                    </div>
                </Card>

                {/* Members */}
                <Card title="Members">
                    {/* Add member row */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end border-b border-gray-200 pb-4 mb-4">
                        <div className="md:col-span-5">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                            <select
                                value={newEmployeeId}
                                onChange={(e) => setNewEmployeeId(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                            >
                                <option value="">Select employee…</option>
                                {staffOptions.map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="md:col-span-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                            <select
                                value={newRole}
                                onChange={(e) => setNewRole(e.target.value as ProjectMemberRole)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                            >
                                {ROLE_OPTIONS.map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Rate</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={newRate}
                                onChange={(e) => setNewRate(e.target.value)}
                                placeholder="Default"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <Button
                                onClick={handleAddMember}
                                isLoading={addingMember}
                                disabled={addingMember}
                                leftIcon={<Plus size={14} />}
                                className="w-full"
                            >
                                Add
                            </Button>
                        </div>
                    </div>

                    {/* Members list */}
                    {loadingMembers ? (
                        <div className="py-6 text-center"><LoaderSpinner /></div>
                    ) : members.length === 0 ? (
                        <p className="py-4 text-center text-sm font-medium text-gray-500">No members yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-gray-500 border-b border-gray-200">
                                        <th className="py-2 pr-3 font-medium">Employee</th>
                                        <th className="py-2 px-3 font-medium">Role</th>
                                        <th className="py-2 px-3 font-medium">Rate</th>
                                        <th className="py-2 px-3 font-medium">Active</th>
                                        <th className="py-2 pl-3 font-medium text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {members.map((m) => (
                                        <tr key={m.id} className="border-b border-gray-100">
                                            <td className="py-2 pr-3">
                                                <div className="font-medium text-gray-900">{fullName(m)}</div>
                                                <div className="text-xs text-gray-500">{m.employee?.email}</div>
                                            </td>
                                            <td className="py-2 px-3">
                                                <div className="flex items-center gap-2">
                                                    <Badge color={m.role === "MANAGER" ? "indigo" : "gray"}>{m.role}</Badge>
                                                    <select
                                                        value={m.role}
                                                        disabled={rowBusyId === m.id}
                                                        onChange={(e) => patchMember(m, { role: e.target.value as ProjectMemberRole })}
                                                        className="px-2 py-1 border border-gray-300 rounded-md text-xs text-gray-950 bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                                                    >
                                                        {ROLE_OPTIONS.map((r) => (
                                                            <option key={r} value={r}>{r}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </td>
                                            <td className="py-2 px-3">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    defaultValue={m.billingRate != null ? String(m.billingRate) : ""}
                                                    disabled={rowBusyId === m.id}
                                                    placeholder="Default"
                                                    onBlur={(e) => {
                                                        const raw = e.target.value;
                                                        const next = raw === "" ? null : Number(raw);
                                                        if (raw !== "" && isNaN(Number(raw))) {
                                                            toast.error("Rate must be a number.");
                                                            return;
                                                        }
                                                        if (next !== m.billingRate) patchMember(m, { billingRate: next });
                                                    }}
                                                    className="w-24 px-2 py-1 border border-gray-300 rounded-md text-xs text-gray-950 focus:outline-none focus:ring-2 focus:ring-purple-600"
                                                />
                                                {m.billingRate != null && (
                                                    <div className="text-xs text-gray-400 mt-1">
                                                        {formatMoney(Number(m.billingRate), defaultCurrencyCode)}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-2 px-3">
                                                <input
                                                    type="checkbox"
                                                    checked={m.isActive}
                                                    disabled={rowBusyId === m.id}
                                                    onChange={(e) => patchMember(m, { isActive: e.target.checked })}
                                                    className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-600"
                                                />
                                            </td>
                                            <td className="py-2 pl-3 text-right">
                                                <Button
                                                    variant="white"
                                                    size="sm"
                                                    disabled={rowBusyId === m.id}
                                                    onClick={() => removeMember(m)}
                                                    leftIcon={<Trash2 size={14} />}
                                                >
                                                    Remove
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>

                <div className="flex justify-end">
                    <Button variant="white" onClick={onClose}>Close</Button>
                </div>
            </div>
        </Modal>
    );
};

export default ProjectMembersPanel;
