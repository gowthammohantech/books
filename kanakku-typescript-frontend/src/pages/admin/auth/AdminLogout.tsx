import { logout } from "@store/auth/authSlice";
import { useEffect } from "react";
import { useDispatch } from "react-redux";

const AdminLogout: React.FC = () => {
    const dispatch = useDispatch();

    const handleLogout = () => {
       dispatch(logout());    
    }

    useEffect(() => {
        handleLogout();
    }, [handleLogout]);
    return (
        <>
        </>
    );
};

export default AdminLogout;