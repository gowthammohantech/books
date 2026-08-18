import type { RootState } from "@store/index";
import { Helmet } from "react-helmet-async";
import { useSelector } from "react-redux";
import { useEffect } from "react";

interface SeoProps {
    title?: string;
    description?: string;
    keywords?: string;
}

const Seo: React.FC<SeoProps> = ({ title, description, keywords }) => {
    const { data: systemSettings } = useSelector((state: RootState) => state.systemSettings);

    const defaultCompanyName = systemSettings?.company?.companyName || "Kanakku";
    const defaultTitle = `${defaultCompanyName} | Business Management`;
    const defaultDescription =
        "Kanakku helps you manage inventory, invoices, and products efficiently.";
    const defaultKeywords = "kanakku, inventory, invoices, billing, products";
    const favicon = systemSettings?.company?.favicon || null;

    const finalTitle = title ? `${defaultCompanyName} | ${title}` : defaultTitle;
    const finalDescription = description || defaultDescription;
    const finalKeywords = keywords || defaultKeywords;

    // Force document title update
    useEffect(() => {
        document.title = finalTitle;
    }, [finalTitle]);

    // Force favicon update
    useEffect(() => {
        if (!favicon) return;

        let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        link.href = favicon;
    }, [favicon]);

    return (
        <Helmet>
            {/* Title */}
            <title>{finalTitle}</title>

            {/* Meta Description */}
            <meta name="description" content={finalDescription} />

            {/* Meta Keywords */}
            <meta name="keywords" content={finalKeywords} />

            {/* Dynamic Favicon */}
            {favicon && <link rel="icon" type="image/png" href={favicon} />}
        </Helmet>
    );
};

export default Seo;