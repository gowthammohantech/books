import api from '@lib/apiClient';
import React, { useEffect, useState } from "react";
import { Eye, EyeOff, User, Mail, Phone, Lock, Building2, Loader2Icon } from "lucide-react";
import type { RegisterFormData } from "@models/register";

import Constants from "@constants/api";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@store/index";
import { registerUser } from "@store/auth/authSlice";
import { useSetupStatus } from "@context/SetupStatusContext";
import { isValidPhone, PHONE_ERROR } from "@elixirbooks/validation";
import AuthShell from "./AuthShell";

/**
 * Public, uncapped signup.
 *
 * This page used to be reachable only on an install with no admin yet, and the
 * backend enforced that with a hard 403 once one existed - which is exactly
 * what made an install serve one company forever. Both are gone: the route is
 * always mounted (routes/AppRoutes.tsx) and the endpoint is rate-limited
 * instead of capped.
 *
 * `companyName` is the new field. A signup now provisions a whole WORKSPACE -
 * its own roles, units, currencies and email templates - and this names it.
 */
const AdminRegister: React.FC = () => {
    const navigate = useNavigate();
    const dispatch: AppDispatch = useDispatch();
    const prepareInitialFormData = () => {
        return {
            firstName: "",
            lastName: "",
            email: "",
            phone: "",
            companyName: "",
            password: "",
            confirmPassword: "",
        };
    }
    const [formData, setFormData] = useState<RegisterFormData>(prepareInitialFormData());
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [isSaving, setIsSaving] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const { setCompanySettingsComplete } = useSetupStatus();
    // undefined = not yet known. An operator can close signups on a
    // self-hosted instance (SIGNUPS_ENABLED), and the endpoint then 403s -
    // better to say so before the visitor fills in a password than after.
    const [signupsEnabled, setSignupsEnabled] = useState<boolean | undefined>();

    useEffect(() => {
        let cancelled = false;
        api
            .get(Constants.APP_VERSION_URL)
            .then((response) => {
                if (cancelled) return;
                const data = response.data?.data;
                // Assume OPEN when the probe cannot be read. A false negative
                // hides a working signup page; a false positive costs one
                // rejected request with the server's own message.
                setSignupsEnabled(data?.signupsEnabled !== false);
            })
            .catch(() => {
                if (!cancelled) setSignupsEnabled(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

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

        if (!formData.companyName.trim()) {
            newErrors.companyName = 'Company name is required.';
        } else if (formData.companyName.trim().length < 2 || formData.companyName.length > 100) {
            newErrors.companyName = 'Company name must be between 2 and 100 characters.';
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
            // The thunk owns the cookies (token, user, active workspace) and the
            // redux transition, so ProtectedRoute sees isAuthenticated without
            // waiting for a reload.
            const result = await dispatch(registerUser(formData));
            if (registerUser.rejected.match(result)) {
                toast.error((result.payload as string) || 'Failed to create your account.');
                return;
            }
            // The workspace exists but has no CompanySettings yet - /setup is
            // what creates it, and this is the same fact the session endpoint
            // would report a moment later. Setting it here avoids a round trip
            // and a flash of the dashboard.
            setCompanySettingsComplete(false);
            navigate('/setup');
        } catch {
            toast.error('Failed to create your account.');
        } finally {
            setIsSaving(false);
        }
    }
    if (signupsEnabled === false) {
        return (
            <AuthShell
                active="signup"
                heading="Sign-ups are closed"
                subheading="This instance is not accepting new workspaces. Ask an administrator to add you, or sign in if you already have an account."
            >
                <Link
                    to="/signin"
                    className="inline-block px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
                >
                    Go to sign in
                </Link>
            </AuthShell>
        );
    }

    return (
        <AuthShell
            active="signup"
            wide
            heading="Start your free trial"
            subheading="You will be the owner of this workspace and can add your team later."
            footer={
                <p className="text-center text-xs text-muted-foreground">
                    By continuing you agree to the Terms &amp; Privacy Policy.
                </p>
            }
        >
                <form className="grid grid-cols-1 md:grid-cols-2 gap-6" onSubmit={handleSubmit}>
                    {/* First Name */}
                    <div className="flex flex-col">
                        <label className="text-sm font-medium text-gray-700 mb-1">
                            First Name <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                            <User className="absolute left-3 top-3 text-gray-600" size={18} />
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
                            <User className="absolute left-3 top-3 text-gray-600" size={18} />
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

                    {/* Company name - names the workspace this signup creates. */}
                    <div className="flex flex-col md:col-span-2">
                        <label className="text-sm font-medium text-gray-700 mb-1">
                            Organization / company name <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                            <Building2 className="absolute left-3 top-3 text-gray-600" size={18} />
                            <input
                                type="text"
                                placeholder="Enter your company name"
                                name="companyName"
                                value={formData.companyName}
                                onChange={handleChange}
                                maxLength={100}
                                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ring focus:outline-none"
                            />
                            {formErrors.companyName && <p className="text-destructive text-xs mt-1">{formErrors.companyName}</p>}
                        </div>
                    </div>

                    {/* Email */}
                    <div className="flex flex-col">
                        <label className="text-sm font-medium text-gray-700 mb-1">
                            Email <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-3 text-gray-600" size={18} />
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
                            <Phone className="absolute left-3 top-3 text-gray-600" size={18} />
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
                            <Lock className="absolute left-3 top-3 text-gray-600" size={18} />
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
                                className="absolute right-3 top-3 text-gray-700 hover:text-primary"
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
                            <Lock className="absolute left-3 top-3 text-gray-600" size={18} />
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
                                className="absolute right-3 top-3 text-gray-700 hover:text-primary"
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
                            className={`flex items-center justify-center gap-2 w-[20rem] max-w-full px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm py-3 rounded-lg transition-all duration-200 shadow-sm ${isSaving ? "opacity-60 cursor-not-allowed" : ""
                                }`}
                        >
                            {isSaving ? (
                                <>
                                    <Loader2Icon size={18} className="animate-spin" />
                                    <span>Registering...</span>
                                </>
                            ) : (
                                "Create workspace"
                            )}
                        </button>
                    </div>
                </form>
        </AuthShell>
    );
};

export default AdminRegister;
