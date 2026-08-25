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
    const { isAuthenticated, isLoading, user, token } = useSelector((state: RootState) => state.auth);
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);
    const dispatch = useDispatch();
    
    if (!isAuthenticated || !token || isTokenExpired(token)) {
        dispatch(logout());
        return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
    }

    if(isLoading || !systemSettings) {
        return <div>Loading...</div>
    }

    if (user?.user_type === 1) {
        return <Outlet />;
    }
    
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