import { LogOut, Settings, UserCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { logout } from "@store/auth/authSlice";
import type { AppDispatch } from "@store/index";
import { useDispatch } from "react-redux";

const BottomBar: React.FC = () => {
    const navigate = useNavigate();
    const dispatch: AppDispatch = useDispatch();
    return (
        <div className="bottom-0 px-6 py-2 bg-gray-50 border-t border-gray-200">
            <div className="flex justify-between items-center">
                <LogOut
                    size={36}
                    onClick={() => dispatch(logout())}
                    className="text-purple-600 p-2 rounded-lg cursor-pointer bg-gray-200 hover:bg-gray-300 transition-all"
                />
                <Settings
                    onClick={() => navigate("/admin/settings/company-settings")}
                    size={36}
                    className="text-purple-600 p-2 rounded-lg cursor-pointer bg-gray-200 hover:bg-gray-300 transition-all"
                />
                <UserCircle2
                    onClick={() => navigate("/admin/settings/profile")}
                    size={36}
                    className="text-purple-600 p-2 rounded-lg cursor-pointer bg-gray-200 hover:bg-gray-300 transition-all"
                />
            </div>
        </div>
    );
};

export default BottomBar;
