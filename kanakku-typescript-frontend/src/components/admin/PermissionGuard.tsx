import type { PermissionAction } from "@models/permissions";
import type { RootState } from "@store/index";
import { hasPermission } from "@utils/hasPermission";
import { useSelector } from "react-redux";

interface PermissionGuardProps {
    moduleSlug: string;
    action: PermissionAction;
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

const PermissionGuard: React.FC<PermissionGuardProps> = ({
    moduleSlug,
    action,
    children,
    fallback,
}) => {
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const permissions = systemSettings?.permissions || [];
    const isAllowed = hasPermission(permissions, moduleSlug, action);

    if (!isAllowed) return <>{fallback && fallback || ""}</>;

    return <>{children}</>;
};

export default PermissionGuard;
