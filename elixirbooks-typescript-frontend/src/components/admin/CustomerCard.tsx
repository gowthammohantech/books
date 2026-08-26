import React, { useState } from "react";

interface CustomerCardProps {
    image?: string | null;
    name: string;
    email?: string;
    phone?: string;
    defaultImage?: string;
    className?: string;
}

const CustomerCard: React.FC<CustomerCardProps> = ({
    image,
    name,
    email,
    phone,
    defaultImage,
    className = "",
}) => {
    const [imgError, setImgError] = useState(false);

    const shouldShowFallback = !image || imgError;
    const firstLetter = name.trim().charAt(0).toUpperCase();

    return (
        <div
            className={`flex gap-3 p-4 bg-gray-50 border border-gray-200 rounded-md ${className}`}
        >
            {/* Avatar */}
            <div className="w-15 h-15 flex items-center justify-center rounded bg-white border border-gray-200">
                {shouldShowFallback ? (
                    defaultImage ? (
                        <img
                            src={defaultImage}
                            alt="Default Customer"
                            className="w-12 h-12 object-contain"
                        />
                    ) : (
                        <div className="w-12 h-12 flex items-center justify-center rounded-full bg-purple-600 text-white font-bold text-xl">
                            {firstLetter || "?"}
                        </div>
                    )
                ) : (
                    <img
                        src={image}
                        alt={name}
                        className="w-12 h-12 object-contain"
                        onError={() => setImgError(true)}
                    />
                )}
            </div>

            {/* Details */}
            <div>
                <h4 className="font-semibold text-gray-950 uppercase">
                    {name}
                </h4>
                {email && (
                    <p className="text-sm text-gray-600">
                        <span className="font-semibold">Email :</span> {email}
                    </p>
                )}
                {phone && (
                    <p className="text-sm text-gray-500">
                        <span className="font-semibold">Phone :</span> {phone}
                    </p>
                )}
            </div>
        </div>
    );
};

export default CustomerCard;
