import React, { useState } from "react";
import { assetUrl } from "@utils/assetUrl";

interface ProfileCardProps {
    imageUrl?: string | null;
    name: string;
    email?: string;
    className?: string;
    defaultImage?: string;
    primary?: boolean;
}

// Deterministic name -> color so the same contact always gets the same
// avatar color across the app (was hardcoded purple for every fallback,
// which made long lists of avatars hard to visually distinguish/scan).
const AVATAR_PALETTE = [
    "bg-purple-600",
    "bg-blue-600",
    "bg-emerald-600",
    "bg-amber-600",
    "bg-rose-600",
    "bg-teal-600",
    "bg-indigo-600",
    "bg-cyan-600",
] as const;

const avatarColorClass = (name: string): string => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
};

const ProfileCard: React.FC<ProfileCardProps> = ({ imageUrl, name, email, className = "", defaultImage, primary = false }) => {
    const [imgError, setImgError] = useState(false);
    const firstLetter = name ? name.trim().charAt(0).toUpperCase() : "?";
    const shouldShowFallback = !imageUrl || imgError;
    const colorClass = avatarColorClass(name || firstLetter);

    return (
        <div className={`flex items-center ${className}`}>
            {shouldShowFallback ? (
                defaultImage ? (
                    <img
                        src={defaultImage}
                        alt="Default Profile"
                        className="h-8 w-8 rounded-full object-cover mr-3 border border-gray-300"
                    />
                ) : (
                    <div className={`h-8 w-8 flex items-center justify-center rounded-full mr-3 border-0 ${colorClass} text-white font-semibold text-xl`}>
                        {firstLetter || "?"}
                    </div>
                )
            ) : (
                <img
                    src={assetUrl(imageUrl)}
                    alt={name}
                    className="h-8 w-8 rounded-full object-cover mr-3 border border-gray-300"
                    onError={() => setImgError(true)}
                />
            )}

            <div>
                <span className={`font-medium ${primary ? "text-indigo-600" : "text-gray-600"} capitalize`}>
                    {name || "Deleted User"}
                </span>
                {email && (
                    <p className="text-gray-500 text-xs font-medium">{email}</p>
                )}
            </div>
        </div>
    );
};

export default ProfileCard;
