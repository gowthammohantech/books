import type { FC } from 'react';
import ProductForm from "../../admin/productAndServices/ProductForm";
import { PageHeader } from "@/context/PageHeaderContext";

const AddProduct: FC = () => {
    return (
        <div className="p-4 bg-white border border-gray-200 rounded-lg ">
            <PageHeader title="New Item" />
            <ProductForm />
        </div>
    );
}

export default AddProduct;