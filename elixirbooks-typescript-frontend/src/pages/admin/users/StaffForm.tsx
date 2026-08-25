import Modal from "@components/admin/Modal"
import SearchableDropdown from "@components/admin/SearchableDropdown";
import SubmitButton from "@components/admin/SubmitButton";
import Constants from "@constants/api";
import type { StaffFormData, StaffList } from "@models/staff";
import type { RootState } from "@store/index";
import axios from "axios";
import { Eye, EyeClosed, Image, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import { isValidPhone, PHONE_ERROR } from "@utils/validation";

interface StaffFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    editItem?: StaffList
}

const initialFormData: StaffFormData = {
    id: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    gender: '',
    dateOfBirth: new Date(),
    password: '',
    address: '',
    roleid: '',
    profileImage: null,
    profile_image_removed: false,
    profile_image_preview_url: '',
    confirmPassword: ''
}

interface RoleOptions {
    id: string;
    name: string;
}
const StaffForm: React.FC<StaffFormProps> = ({ isOpen, onClose, onSuccess, editItem }) => {
    const { token } = useSelector((state: RootState) => state.auth);
    const [formData, setFormData] = useState<StaffFormData>(initialFormData);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [showPassword, setShowPassword] = useState<boolean>(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
    const [roleOptions, setRoleOptions] = useState<RoleOptions[]>([]);
    const [selectedRole, setSelectedRole] = useState<RoleOptions | null>(null);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    useEffect(() => {
        if (editItem) {
            setFormData(prev => ({
                ...prev,
                firstName: editItem.firstName,
                lastName: editItem.lastName,
                email: editItem.email,
                phone: editItem.phone,
                address: editItem.address || '',
                roleid: editItem.roleid,
                profile_image_preview_url: editItem.profileImage,
                id: editItem.id,
                profile_image_removed: false
            }));

            setSelectedRole(roleOptions.find(role => role.id === editItem.roleid) || null);
        } else {
            setFormData(initialFormData);
            setSelectedRole(null);
        }
        setFormErrors({});
    }, [isOpen]);

    useEffect(() => {
        const fetchRoleOptions = async () => {
            try {
                const response = await axios.get(Constants.FETCH_ALL_ROLES_URL, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const roles = response.data.data;
                if (roles) {
                    const options = roles.map((role: any) => ({
                        id: role.id,
                        name: role.roleName
                    }));
                    setRoleOptions(options);
                }
            } catch (error) {
                console.error('Error fetching role options:', error);
            }
        }
        fetchRoleOptions();
    }, []);

    const handleImageDelete = () => {
        setFormData({
            ...formData,
            profileImage: null,
            profile_image_preview_url: '',
            profile_image_removed: true
        })
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setFormData({
                ...formData,
                profileImage: file,
                profile_image_preview_url: URL.createObjectURL(file)
            })
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData({
            ...formData,
            [name]: value
        })
    }

    const togglePasswordVisibility = () => {
        setShowPassword(!showPassword);
    }

    const toggleConfirmPasswordVisibility = () => {
        setShowConfirmPassword(!showConfirmPassword);
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
        if (!formData.phone.trim()) {
            newErrors.phone = 'Phone is required.';
        } else if (!isValidPhone(formData.phone)) {
            newErrors.phone = PHONE_ERROR;
        }

        if (!editItem) {
            // Create mode password is mandatory
            if (!formData.password.trim()) {
                newErrors.password = "Password is required.";
            } else if (formData.password.length < 6 || formData.password.length > 50) {
                newErrors.password = "Password must be between 6 and 50 characters.";
            }

            if (!formData.confirmPassword.trim()) {
                newErrors.confirmPassword = "Confirm Password is required.";
            } else if (formData.confirmPassword !== formData.password) {
                newErrors.confirmPassword = "Passwords do not match.";
            }
        } else {
            // Edit mode password optional, only validate if user typed it
            if (formData.password.trim()) {
                if (formData.password.length < 6 || formData.password.length > 50) {
                    newErrors.password = "Password must be between 6 and 50 characters.";
                }
                if (!formData.confirmPassword.trim()) {
                    newErrors.confirmPassword = "Confirm Password is required when changing password.";
                } else if (formData.confirmPassword !== formData.password) {
                    newErrors.confirmPassword = "Passwords do not match.";
                }
            }
        }


        if (!selectedRole) {
            newErrors.roleid = 'Role is required.';
        }
        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;
        try {
            setIsSaving(true);
            let payload = new FormData();
            payload.append('firstName', formData.firstName);
            payload.append('lastName', formData.lastName);
            payload.append('email', formData.email);
            payload.append('phone', formData.phone);
            if (!editItem) {
                // Always required for create
                payload.append('password', formData.password);
                payload.append('confirmPassword', formData.confirmPassword);
            } else if (formData.password.trim()) {
                // Only if user typed a new one during edit
                payload.append('password', formData.password);
                payload.append('confirmPassword', formData.confirmPassword);
            }

            payload.append('address', formData.address);
            payload.append('roleId', selectedRole?.id || '');
            if (formData.profileImage instanceof File) {
                payload.append('profileImage', formData.profileImage);
            }
            if (formData.profile_image_removed) {
                payload.append('profile_image_removed', 'true');
            }
            if (editItem) {
                await axios.put(`${Constants.UPDATE_STAFF_URL}/${editItem.id}`, payload, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    }
                })
                toast.success('User updated successfully.');
                onSuccess();
            } else {
                await axios.post(Constants.CREATE_STAFF_URL, payload, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    }
                })
                toast.success('User created successfully.');
                onSuccess();
            }
        } catch (error) {
            toast.error('Failed to create user.');
        } finally {
            setIsSaving(false);
        }
    }
    return (
        <Modal isOpen={isOpen} onClose={() => { onClose(); onSuccess(); }} title={editItem ? 'Edit User' : 'Create User'}>
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="flex items-start gap-4 mb-4">
                    {/* Image Preview or Default */}
                    <div className="relative w-20 h-20 border border-gray-300 rounded-md flex items-center justify-center overflow-hidden bg-white">
                        {formData.profile_image_preview_url ? (
                            <img
                                src={formData.profile_image_preview_url}
                                alt="Preview"
                                className="w-full h-full object-cover rounded"
                            />
                        ) : (
                            <span className="text-xl text-gray-400"><Image /></span>
                        )}

                        {/* Delete Button on Preview */}
                        {formData.profile_image_preview_url && (
                            <button
                                type="button"
                                className="absolute top-[0px] right-[-1px] bg-white border border-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-500 hover:border-white transition duration-200"
                                onClick={handleImageDelete}
                                title="Remove Image"
                            >
                                <Trash2Icon size={14} className="text-red-500 hover:text-white cursor-pointer" />
                            </button>
                        )}
                    </div>

                    {/* Upload Button and Note */}
                    <div>
                        <label htmlFor="imageUpload">
                            <input
                                type="file"
                                accept="image/png, image/jpeg"
                                onChange={handleFileChange}
                                className="hidden"
                                id="imageUpload"
                            />
                            <span className="inline-flex items-center bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-md transition duration-200 cursor-pointer">
                                <Image size={16} className="mr-2" />
                                Upload Image
                            </span>

                        </label>
                        <p className="text-xs text-gray-500 mt-1">JPG or PNG format, not exceeding 5MB.</p>
                    </div>
                </div>


                {/* Name */}
                <div className="flex gap-4">
                    <div className="flex-1">
                        <label className="block font-medium text-sm text-gray-700 ">
                            First Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            name="firstName"
                            value={formData.firstName}
                            onChange={handleChange}
                            type="text"
                            placeholder="Enter First Name"
                            className="border border-gray-300 rounded-md px-4 py-2 w-full   text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-none"
                        />
                        {formErrors.firstName && <p className="text-red-500 text-xs mt-1">{formErrors.firstName}</p>}
                    </div>
                    <div className="flex-1">
                        <label className="block font-medium text-sm text-gray-700 ">
                            Last Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            name="lastName"
                            value={formData.lastName}
                            onChange={handleChange}
                            type="text"
                            placeholder="Enter Last Name"
                            className="border border-gray-300 rounded-md px-4 py-2 w-full   text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-none"
                        />
                        {formErrors.lastName && <p className="text-red-500 text-xs mt-1">{formErrors.lastName}</p>}
                    </div>
                </div>

                {/* Email & Phone */}
                <div className="flex gap-4">
                    <div className="flex-1">
                        <label className="block font-medium text-sm text-gray-700 ">
                            Email <span className="text-red-500">*</span>
                        </label>
                        <input
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            type="email"
                            placeholder="Enter Email Address"
                            className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-none"
                        />
                        {formErrors.email && <p className="text-red-500 text-xs mt-1">{formErrors.email}</p>}
                    </div>
                    <div className="flex-1">
                        <label className="block font-medium text-sm text-gray-700 ">
                            Phone Number <span className="text-red-500">*</span>
                        </label>
                        <input
                            name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            type="tel"
                            placeholder="Enter Phone Number"
                            className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-none"
                        />
                        {formErrors.phone && <p className="text-red-500 text-xs mt-1">{formErrors.phone}</p>}
                    </div>
                </div>
                {/* Password & Confirm Password with eye icon */}
                <div className="flex gap-4">
                    <div className="flex-1">
                        <label className="block font-medium text-sm text-gray-700 ">
                            Password {editItem ? '' : <span className="text-red-500">*</span>}
                        </label>
                        <div className="relative">
                            <input
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                type={showPassword ? "text" : "password"}
                                placeholder="Enter Password"
                                className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-none"
                            />
                            <span
                                className="absolute inset-y-0 right-0 flex items-center pr-3 cursor-pointer"
                                onClick={togglePasswordVisibility}
                            >
                                {showPassword ? (
                                    <Eye size={16} className="text-gray-500" />
                                ) : (
                                    <EyeClosed size={16} className="text-gray-500" />
                                )}
                            </span>
                        </div>
                        {formErrors.password && <p className="text-red-500 text-xs mt-1">{formErrors.password}</p>}
                    </div>
                    <div className="flex-1">
                        <label className="block font-medium text-sm text-gray-700 ">
                            Confirm Password {editItem ? '' : <span className="text-red-500">*</span>}
                        </label>
                        <div className="relative">
                            <input
                                name="confirmPassword"
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                type={showConfirmPassword ? "text" : "password"}
                                placeholder="Confirm Password"
                                className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-none"
                            />
                            <span
                                className="absolute inset-y-0 right-0 flex items-center pr-3 cursor-pointer"
                                onClick={toggleConfirmPasswordVisibility}
                            >
                                {showConfirmPassword ? (
                                    <Eye size={16} className="text-gray-500" />
                                ) : (
                                    <EyeClosed size={16} className="text-gray-500" />
                                )}
                            </span>
                        </div>
                        {formErrors.confirmPassword && <p className="text-red-500 text-xs mt-1">{formErrors.confirmPassword}</p>}
                    </div>
                </div>
                {/* address textarea/single row / full width */}
                <div className="mb-4">
                    <label className="block font-medium text-sm text-gray-700 ">
                        Address
                    </label>
                    <textarea
                        name="address"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        placeholder="Enter Address"
                        className="border border-gray-300 rounded-md px-4 py-2 w-full  text-gray-950  focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-none"
                    />
                    {formErrors.address && <p className="text-red-500 text-xs mt-1">{formErrors.address}</p>}
                </div>
                {/* Role */}
                <div className="mb-4">
                    <label className="block font-medium text-sm text-gray-700 ">
                        Role <span className="text-red-500">*</span>
                    </label>
                    <SearchableDropdown
                        placeholder="Select Role"
                        options={roleOptions}
                        value={selectedRole}
                        onChange={(_, value) => setSelectedRole(value)}
                    />
                    {formErrors.roleid && <p className="text-red-500 text-xs mt-1">{formErrors.roleid}</p>}
                </div>
                {/* Buttons */}
                <div className="flex justify-end pt-4 gap-3">
                    <button
                        type="button"
                        className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100 cursor-pointer"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <SubmitButton isDisabled={isSaving} isLoading={isSaving} mode={editItem ? "edit" : "create"} />
                </div>
            </form>
        </Modal>
    )
}

export default StaffForm;