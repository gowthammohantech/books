import React, { useState } from "react";
import { Eye, EyeOff, User, Mail, Phone, Lock, Loader2Icon } from "lucide-react";
import type { RegisterFormData } from "@models/register";
import axios from "axios";
import Cookies from "js-cookie";
import Constants from "@constants/api";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@store/index";
import { initializeAuth } from "@store/auth/authSlice";
import { useSetupStatus } from "@context/SetupStatusContext";
import { isValidPhone, PHONE_ERROR } from "@utils/validation";

const AdminRegister: React.FC = () => {
    const navigate = useNavigate();
    const dispatch: AppDispatch = useDispatch();
    const prepareInitialFormData = () => {
        return {
            firstName: "",
            lastName: "",
            email: "",
            phone: "",
            password: "",
            confirmPassword: "",
        };
    }
    const [formData, setFormData] = useState<RegisterFormData>(prepareInitialFormData());
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isSaving, setIsSaving] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const { setStatus } = useSetupStatus();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        const inputValue = value;
        // Phone left as-is — international numbers may contain +, (), -, spaces.
        setFormData((prevFormData) => ({
            ...prevFormData,
            [name]: inputValue,
        }));
    }

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!formData.firstName.trim()) {
            newErrors.firstName = 'First name is required.';
        } else if (formData.firstName.length < 3 || formData.firstName.length > 50) {
            newErrors.firstName = 'First name must be between 3 and 50 characters.';
        }

        if (!formData.lastName.trim()) {
            newErrors.lastName = 'Last name is required.';
        } else if (formData.lastName.length < 3 || formData.lastName.length > 50) {
            newErrors.lastName = 'Last name must be between 3 and 50 characters.';
        }

        if (!formData.email.trim()) {
            newErrors.email = 'Email is required.';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            newErrors.email = 'Invalid email format.';
        }
        if (!formData.phone) {
            newErrors.phone = 'Phone number is required.';
        }
        else if (formData.phone && !isValidPhone(formData.phone)) {
            newErrors.phone = PHONE_ERROR;
        }

        if (!formData.password.trim()) {
            newErrors.password = 'Password is required.';
        } else if (formData.password.length < 8) {
            newErrors.password = 'Password must be at least 8 characters.';
        }

        if (!formData.confirmPassword.trim()) {
            newErrors.confirmPassword = 'Confirm password is required.';
        } else if (formData.confirmPassword !== formData.password) {
            newErrors.confirmPassword = 'Passwords do not match.';
        }

        setFormErrors(newErrors);

        return Object.keys(newErrors).length === 0;
    }
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!validateForm()) return;
        try {
            setIsSaving(true);
            const response = await axios.post(Constants.REGISTER_URL, formData);
            const token = response.data.token;
            const user = response.data.user;
            // Store in cookies (same options as loginUser in authSlice) so the
            // auth system's cookie-based readers find the token immediately.
            Cookies.set("authToken", token, { secure: window.location.protocol === "https:", sameSite: "Strict", expires: 7 });
            Cookies.set("authUser", JSON.stringify(user), { secure: window.location.protocol === "https:", sameSite: "Strict", expires: 7 });
            // Sync Redux state so ProtectedRoute sees isAuthenticated = true
            // without waiting for a reload.
            dispatch(initializeAuth());
            sessionStorage.setItem("setupStatus", JSON.stringify({
                new_register: false,       // user just registered
                company_settings: true     // company setup pending
            }));
            setStatus({
                new_register: false,      // user just registered
                company_settings: true,   // company setup pending
            });

            navigate('/setup');
        } catch (error) {
            toast.error('Failed to register admin.');
        } finally {
            setIsSaving(false);
        }
    }
    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-200 p-10">
                <h2 className="text-2xl font-bold text-center text-primary mb-8">
                    Admin Registration
                </h2>

                <form className="grid grid-cols-1 md:grid-cols-2 gap-6" onSubmit={handleSubmit}>
                    {/* First Name */}
                    <div className="flex flex-col">
                        <label className="text-sm font-medium text-gray-700 mb-1">
                            First Name <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                            <User className="absolute left-3 top-3 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="Enter your first name"
                                name="firstName"
                                value={formData.firstName}
                                onChange={handleChange}
                                maxLength={30}
                                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ring focus:outline-none"
                            />
                            {formErrors.firstName && <p className="text-destructive text-xs mt-1">{formErrors.firstName}</p>}
                        </div>
                    </div>

                    {/* Last Name */}
                    <div className="flex flex-col">
                        <label className="text-sm font-medium text-gray-700 mb-1">
                            Last Name <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                            <User className="absolute left-3 top-3 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="Enter your last name"
                                name="lastName"
                                value={formData.lastName}
                                onChange={handleChange}
                                maxLength={30}
                                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ring focus:outline-none"
                            />
                            {formErrors.lastName && <p className="text-destructive text-xs mt-1">{formErrors.lastName}</p>}
                        </div>
                    </div>

                    {/* Email */}
                    <div className="flex flex-col">
                        <label className="text-sm font-medium text-gray-700 mb-1">
                            Email <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                            <input
                                type="email"
                                placeholder="Enter your email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                maxLength={70}
                                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ring focus:outline-none"
                            />
                            {formErrors.email && <p className="text-destructive text-xs mt-1">{formErrors.email}</p>}
                        </div>
                    </div>

                    {/* Phone */}
                    <div className="flex flex-col">
                        <label className="text-sm font-medium text-gray-700 mb-1">
                            Phone <em className="text-destructive">*</em>
                        </label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-3 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="Enter your phone number"
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                                maxLength={20}
                                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ring focus:outline-none"
                            />
                            {formErrors.phone && <p className="text-destructive text-xs mt-1">{formErrors.phone}</p>}
                        </div>
                    </div>

                    {/* Password */}
                    <div className="flex flex-col">
                        <label className="text-sm font-medium text-gray-700 mb-1">
                            Password <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                            <input
                                type={showPassword ? "text" : "password"}
                                placeholder="Enter your password"
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                maxLength={30}
                                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ring focus:outline-none"
                            />
                            {formErrors.password && <p className="text-destructive text-xs mt-1">{formErrors.password}</p>}
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-3 text-gray-500 hover:text-primary"
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    {/* Confirm Password */}
                    <div className="flex flex-col">
                        <label className="text-sm font-medium text-gray-700 mb-1">
                            Confirm Password <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                            <input
                                type={showConfirmPassword ? "text" : "password"}
                                placeholder="Re-enter your password"
                                name="confirmPassword"
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                maxLength={30}
                                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ring focus:outline-none"
                            />
                            {formErrors.confirmPassword && <p className="text-destructive text-xs mt-1">{formErrors.confirmPassword}</p>}
                            <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-3 text-gray-500 hover:text-primary"
                            >
                                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <div className="md:col-span-2 mt-6 flex justify-center">
                        <button
                            type="submit"
                            disabled={isSaving}
                            className={`flex items-center justify-center gap-2 w-[320px] max-w-full px-6 bg-primary hover:bg-primary/90 text-white font-medium text-sm py-3 rounded-lg transition-all duration-200 shadow-sm ${isSaving ? "opacity-60 cursor-not-allowed" : ""
                                }`}
                        >
                            {isSaving ? (
                                <>
                                    <Loader2Icon size={18} className="animate-spin" />
                                    <span>Registering...</span>
                                </>
                            ) : (
                                "Register"
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AdminRegister;
