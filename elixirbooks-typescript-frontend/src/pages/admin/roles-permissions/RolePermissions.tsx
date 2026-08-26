import CustomCheckbox from "@components/admin/CustomCheckbox";
import FullPageLoader from "@components/admin/FullPageLoader";
import NoRecords from "@components/admin/NoRecords";
import Constants from "@constants/api";
import { PageHeader } from "@/context/PageHeaderContext";
import { Button, Select } from "@components/ui";
import type { SelectOption } from "@components/ui";
import { Save } from "lucide-react";
import type { ModuleList } from "@models/role-permissions";
import type { RootState } from "@store/index";
import { MODULE_LANDING_PATHS } from "@utils/roleLanding";
import axios from "axios";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

const DEFAULT_ROUTE_OPTIONS: SelectOption[] = Object.entries(MODULE_LANDING_PATHS).map(
    ([slug, { label }]) => ({ value: slug, label })
);

export type ModuleListResponse = {
    success: boolean,
    message: string,
    data: ModuleList[]
}
type RolePermissionsResponse = {
    success: boolean,
    message: string,
    data: RolePermissions
}
interface Permissions {
    create: boolean;
    edit: boolean;
    delete: boolean;
    view: boolean;
    allowAll: boolean;
}
interface RolePermissions {
    roleId: string;
    roleName: string;
    permissions: PermissionsList[];
    /** Configurable post-login landing page (moduleSlug). Optional: older
     *  backends won't send this yet, in which case the select defaults to
     *  "dashboard" below. */
    defaultRoute?: string;
}

interface PermissionsList {
    id: string;
    roleId: string;
    /** Prisma returns the scalar FK as a string; the relation is under `module`. */
    moduleId: string;
    module?: {
        id: string;
        moduleName: string;
    };
    create: boolean;
    edit: boolean;
    delete: boolean;
    view: boolean;
    allowAll: boolean;
}
const RolePermissions: React.FC = () => {
    const { token } = useSelector((state: RootState) => state.auth);
    const { id: roleId } = useParams();
    const [modules, setModules] = useState<ModuleList[]>([]);
    const [allModules, setAllModules] = useState<ModuleList[]>([]);
    const [allRolePermissions, setAllRolePermissions] = useState<RolePermissions | null>(null);
    const [defaultRoute, setDefaultRoute] = useState<string>("dashboard");
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isFetching, setIsFetching] = useState<boolean>(false);
    const navigate = useNavigate();
    useEffect(() => {
        const fetchModules = async () => {
            try {
                const response = await axios.get<ModuleListResponse>(
                    `${Constants.FETCH_MODULES_URL}`,
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                setAllModules(response.data.data);
            } catch (error) {
                console.error("Failed to fetch modules:", error);
                toast.error("Could not load modules.");
            }
        };

        const fetchRolePermissions = async () => {
            try {
                setIsFetching(true);
                const response = await axios.get<RolePermissionsResponse>(
                    `${Constants.FETCH_ROLE_PERMISSIONS_URL}/${roleId}`,
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                setAllRolePermissions(response.data.data);
                setDefaultRoute(response.data.data.defaultRoute || "dashboard");
            } catch (error) {
                console.error("Failed to fetch role permissions:", error);
                toast.error("Could not load role permissions.");
            } finally {
                setIsFetching(false);
            }
        };

        if (roleId) {
            fetchModules();
            fetchRolePermissions();
        }
    }, [roleId, token]);

    // process once both are fetched
    useEffect(() => {
        if (allModules.length && allRolePermissions && allRolePermissions) {
            const permissionFor = (moduleId: string) => {
                const existingPermission = allRolePermissions.permissions.find(
                    (rp) => rp.moduleId === moduleId
                );
                return existingPermission
                    ? {
                        create: existingPermission.create,
                        edit: existingPermission.edit,
                        delete: existingPermission.delete,
                        view: existingPermission.view,
                        allowAll: existingPermission.allowAll,
                    }
                    : {
                        create: false,
                        edit: false,
                        delete: false,
                        view: false,
                        allowAll: false,
                    };
            };

            const processedModules = allModules.map((module) => {
                // Leaf module (e.g. AI): no children of its own. Render the module
                // itself as a single toggleable row so its permission can be set —
                // the grid only renders child rows, so a childless module would
                // otherwise be impossible to enable.
                if (!module.children || module.children.length === 0) {
                    return {
                        ...module,
                        isLeaf: true,
                        children: [{ ...module, permissions: permissionFor(module.id) }],
                    };
                }

                return {
                    ...module,
                    children: module.children.map((child) => ({
                        ...child,
                        permissions: permissionFor(child.id),
                    })),
                };
            });

            setModules(processedModules);
        }
    }, [allModules, allRolePermissions]);

    const handleChange = (moduleIndex: number, childIndex: number, permissionType: keyof Permissions) => {
        const updatedModules = modules.map((module, mIndex) => {
            if (mIndex !== moduleIndex) {
                return module;
            }

            return {
                ...module,
                children: module.children.map((child, cIndex) => {
                    if (cIndex !== childIndex) {
                        return child;
                    }

                    const updatedPermissions = { ...child.permissions };

                    if (permissionType === 'allowAll') {
                        // If the "Allow All" checkbox is clicked, its new state determines all others.
                        const newCheckedState = !updatedPermissions.allowAll;
                        updatedPermissions.create = newCheckedState;
                        updatedPermissions.edit = newCheckedState;
                        updatedPermissions.delete = newCheckedState;
                        updatedPermissions.view = newCheckedState;
                        updatedPermissions.allowAll = newCheckedState;
                    } else {
                        // If any other checkbox is clicked, just toggle its state.
                        updatedPermissions[permissionType] = !updatedPermissions[permissionType];

                        // If the "Allow All" checkbox is now unchecked, update its state.
                        updatedPermissions.allowAll =
                            updatedPermissions.create &&
                            updatedPermissions.edit &&
                            updatedPermissions.delete &&
                            updatedPermissions.view;
                    }

                    return {
                        ...child,
                        permissions: updatedPermissions
                    };
                })
            };
        });
        setModules(updatedModules);
    };

    const handleModuleAllowAllChange = (moduleIndex: number) => {
        const updatedModules = modules.map((module, mIndex) => {
            if (mIndex !== moduleIndex) {
                return module; // This is not the module group we're changing.
            }

            const isEverythingChecked = module.children.every(
                child => child.permissions.allowAll
            );

            const newCheckedState = !isEverythingChecked;

            const updatedChildren = module.children.map(child => {
                return {
                    ...child,
                    permissions: {
                        create: newCheckedState,
                        edit: newCheckedState,
                        delete: newCheckedState,
                        view: newCheckedState,
                        allowAll: newCheckedState
                    }
                };
            });

            return {
                ...module,
                children: updatedChildren
            };
        });

        // 5. Update the state with the new array.
        setModules(updatedModules);
    };

    const handleFormSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        try {
            setIsSaving(true);
            let permissions: any = [];
            modules.map((module) => {
                return module.children.map((child) => {
                    permissions.push({
                        moduleId: child.id,
                        create: child.permissions.create,
                        edit: child.permissions.edit,
                        delete: child.permissions.delete,
                        view: child.permissions.view,
                        allowAll: child.permissions.allowAll
                    });
                })
            });
            //compare with allModules & manually inject allowAll permission to parent module only if any child is checked
            modules.map((module) => {
                // Leaf modules already pushed their own permission row above (the
                // lone child shares the module id), so skip the parent injection —
                // otherwise it would overwrite the real toggles for the same id.
                if (module.isLeaf) {
                    return;
                }
                const isAnyChildChecked = module.children.some((child) =>
                    child.permissions.view ||
                    child.permissions.allowAll
                );
                if (isAnyChildChecked) {
                    permissions.push({
                        moduleId: module.id,
                        create: true,
                        edit: true,
                        delete: true,
                        view: true,
                        allowAll: true
                    });
                } else {
                    permissions.push({
                        moduleId: module.id,
                        create: false,
                        edit: false,
                        delete: false,
                        view: false,
                        allowAll: false
                    });
                }
            })
            const payloadData = {
                roleId: roleId,
                permissions: permissions,
                defaultRoute: defaultRoute
            }

            await axios.post(`${Constants.SAVE_PERMISSIONS_URL}`, payloadData, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            toast.success("Permissions saved successfully.");

        } catch (error) {
            console.error("Error submitting form:", error);
            toast.error("An error occurred while saving. Please try again.");
        } finally {
            setIsSaving(false);
        }
    }
    return (
        <div className="p-6">
            <PageHeader title="Role Permissions">
                <Button
                    type="button"
                    variant="white"
                    onClick={() => navigate('/admin/roles')}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    form="role-permissions-form"
                    variant="primary"
                    disabled={isSaving}
                    isLoading={isSaving}
                    leftIcon={<Save size={16} />}
                >
                    {isSaving ? "Saving..." : "Save Changes"}
                </Button>
            </PageHeader>
            <div className="flex flex-1 items-center bg-white shadow-card rounded-card border border-border mb-6">
                <p className="font-bold text-gray-950 p-4 flex-1">Role Name: {allRolePermissions && allRolePermissions.roleName || ""}</p>
                <div className="w-64 pr-4">
                    <Select
                        label="Default landing page"
                        options={DEFAULT_ROUTE_OPTIONS}
                        value={defaultRoute}
                        onChange={(e) => setDefaultRoute(e.target.value)}
                    />
                </div>
            </div>
            <form id="role-permissions-form" onSubmit={handleFormSubmit}>
                {modules && modules.length > 0 && (
                    modules.map((module, moduleIndex) => (
                        <div key={moduleIndex} className="permissions mb-6">
                            <div className="bg-white shadow-card rounded-card border border-border">
                                {/* Header */}
                                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                                    <h2 className="font-bold text-gray-950">{module.moduleName}</h2>
                                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                                        <CustomCheckbox
                                            checked={module.children.length > 0 && module.children.every(child => child.permissions.allowAll)}
                                            onChange={() => handleModuleAllowAllChange(moduleIndex)}
                                        />
                                        Allow All
                                    </label>
                                </div>

                                {/* Table */}
                                <div className="overflow-x-auto border border-border rounded-control">
                                    <table className="w-full border-collapse">
                                        <thead className="bg-gray-100 text-xs uppercase text-body">
                                            <tr>
                                                <th className="px-4 py-3 text-left border-b border-border">MODULE</th>
                                                <th className="px-4 py-3 text-left border-b border-border">CREATE</th>
                                                <th className="px-4 py-3 text-left border-b border-border">EDIT</th>
                                                <th className="px-4 py-3 text-left border-b border-border">DELETE</th>
                                                <th className="px-4 py-3 text-left border-b border-border">VIEW</th>
                                                <th className="px-4 py-3 text-left border-b border-border">ALLOW ALL</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {!module.children || module.children.length === 0 ? (
                                                <NoRecords colSpan={6} message="No modules found" />
                                            ) : (
                                                module.children.map((child, childIndex) => (
                                                    <tr key={childIndex} className="border-b border-border hover:bg-gray-50 text-sm text-left">
                                                        <td className="px-4 py-3 text-sm font-medium text-gray-950">
                                                            {child.moduleName}
                                                        </td>
                                                        <td className="px-4 py-3 ">
                                                            <CustomCheckbox
                                                                checked={child?.permissions?.create || false}
                                                                onChange={() => handleChange(moduleIndex, childIndex, 'create')} />
                                                        </td>
                                                        <td className="px-4 py-3 ">
                                                            <CustomCheckbox checked={child?.permissions?.edit || false}
                                                                onChange={() => handleChange(moduleIndex, childIndex, 'edit')} />
                                                        </td>
                                                        <td className="px-4 py-3 ">
                                                            <CustomCheckbox checked={child?.permissions?.delete || false}
                                                                onChange={() => handleChange(moduleIndex, childIndex, 'delete')} />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <CustomCheckbox checked={child?.permissions?.view || false}
                                                                onChange={() => handleChange(moduleIndex, childIndex, 'view')} />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <CustomCheckbox checked={child?.permissions?.allowAll || false}
                                                                onChange={() => handleChange(moduleIndex, childIndex, 'allowAll')} />
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </form>
            {isFetching && <FullPageLoader />}
        </div>
    );
}

export default RolePermissions;