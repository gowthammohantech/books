import { logout } from "@store/auth/authSlice";
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { Navigate } from "react-router-dom";

/**
 * Sign out, then land on the login page.
 *
 * The redirect is this component's own job now. It used to be mounted only
 * inside the protected tree, where ProtectedRoute noticed the session was gone
 * and bounced to /admin/login as a side effect. AppRoutes also mounts this
 * route OUTSIDE that tree — so a user whose workspace is mid-setup has a way
 * out — and there is no ProtectedRoute above it there to do the bouncing.
 * Relying on a guard that may not be in the tree above you is how you get a
 * blank page after signing out.
 */
const AdminLogout: React.FC = () => {
    const dispatch = useDispatch();

    // Empty deps: sign out once on mount. The previous `[handleLogout]` was a
    // freshly created function on every render, so the effect re-ran and
    // re-dispatched on each one.
    useEffect(() => {
        dispatch(logout());
    }, [dispatch]);

    return <Navigate to="/signin" replace />;
};

export default AdminLogout;
