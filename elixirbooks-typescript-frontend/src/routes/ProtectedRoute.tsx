import { useDispatch, useSelector } from "react-redux"
import type { RootState } from "../store"
import { Navigate, Outlet } from "react-router-dom";
import type { PermissionAction } from "@models/permissions";
import { hasPermission } from "@utils/hasPermission";
import { isTokenExpired } from "@utils/auth";
import { logout } from "@store/auth/authSlice";
interface ProtectedRouteProps {
    moduleSlug?: string;
    action?: string;
}
const ProtectedRoute: React.FC<ProtectedRouteProps> = ( { moduleSlug, action}) => {
    const { isAuthenticated, isLoading, token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const dispatch = useDispatch();
    
    if (!isAuthenticated || !token || isTokenExpired(token)) {
        dispatch(logout());
        return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
    }

    if(isLoading || !systemSettings) {
        return <div>Loading...</div>
    }

    // The `user_type === 1` bypass that used to sit here is GONE. It granted
    // full UI access to anyone whose signup marked them an admin — install-wide,
    // so a user_type:1 account in ANY workspace reached every page in whichever
    // workspace they were currently in, regardless of what their membership
    // there permitted. It was also redundant: provisioning gives every
    // workspace's Owner role allowAll on every module, which is the same reason
    // the backend could already drop its own copy of this bypass
    // (middleware/requirePermission.ts). Permissions are now the only gate, and
    // they are the ones the server issued for THIS workspace.
    if (moduleSlug && action) {
        const permissions = systemSettings?.permissions || [];
        const isAllowed = hasPermission(permissions, moduleSlug, action as PermissionAction);
        if (!isAllowed) {
            return <Navigate to="/admin/unauthorized" />;
        }
    }
    
    return <Outlet />
}

export default ProtectedRoute;