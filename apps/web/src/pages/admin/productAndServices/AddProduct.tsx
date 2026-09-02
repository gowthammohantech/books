import type { FC } from 'react';
import ProductForm from "../../admin/productAndServices/ProductForm";
import { RouteDrawer } from "@components/ui";

const AddProduct: FC = () => {
    return (
        <RouteDrawer title="New Item">
            <ProductForm />
        </RouteDrawer>
    );
}

export default AddProduct;
