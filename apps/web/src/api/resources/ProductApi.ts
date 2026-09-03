/**
 * The Products API as one class.
 *
 * Replaces six `constants/api.ts` keys that all resolve to `/admin/products` —
 * FETCH_PRODUCTS_URL, CREATE_PRODUCT_URL, UPDATE_PRODUCT_URL, DELETE_PRODUCT_URL
 * and two more — plus the catalogue lookups the product forms need.
 *
 * It is the counterpart of `apps/api/modules/product/`, deliberately: one class
 * per backend module, same name, same path. When the two drift it shows up as a
 * missing method rather than a 404 at runtime.
 *
 * `constants/api.ts` keeps those keys. 570 call sites still read them, and
 * deleting one before its last caller moves is a build break.
 */
import Constants from '@constants/api';

import { ApiClient } from '../core/ApiClient';
import { ResourceApi, type ListParams, type Pagination } from '../core/ResourceApi';

/** A product as the list and detail endpoints return it. */
export interface ProductRow {
  id: string;
  name: string;
  code: string;
  item_type: 'Product' | 'Service';
  selling_price: string | number;
  purchase_price: string | number;
  stock: number;
  alert_quantity: number;
  barcode: string | null;
  description: string | null;
  status: boolean;
  enable_inventory: boolean;
  currencyCode: string | null;
  category?: { id: string; category_name: string } | null;
  brand?: { id: string; brand_name: string } | null;
  unit?: { id: string; unit_name: string; short_name: string } | null;
  tax_rate?: number | null;
}

export interface ProductListParams extends ListParams {
  item_type?: 'Product' | 'Service';
}

/** `{ id, categoryName|brandName|unitName, status, ... }` — the catalogue shape. */
export interface CatalogueOption {
  id: string;
  status: boolean;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export class ProductApi extends ResourceApi<ProductRow> {
  protected readonly path = `${Constants.API_BASE_URL}/admin/products`;
  protected readonly listKey = 'products';

  async list(params?: ProductListParams): Promise<{ rows: ProductRow[]; pagination: Pagination }> {
    return await super.list(params);
  }

  /**
   * Create or update with images.
   *
   * Products are written as multipart because the form carries `product_image`,
   * `gallery_images` and `customField_<id>` uploads. The client leaves
   * Content-Type unset so the browser can set the multipart boundary.
   */
  async createWithFiles(form: FormData): Promise<ProductRow> {
    return await this.upload<ProductRow>(this.path, form, 'post');
  }

  async updateWithFiles(id: string, form: FormData): Promise<ProductRow> {
    return await this.upload<ProductRow>(`${this.path}/${id}`, form, 'put');
  }
}

/**
 * The four catalogue lookups the product form needs.
 *
 * Separate from ProductApi because they are their own resources on the backend
 * (`/admin/product-categories` and friends) even though only the product screens
 * read them. Each returns `{ success, message, data, count }` — `data` is what
 * the client hands back.
 */
export class ProductCatalogueApi extends ApiClient {
  categories(search = ''): Promise<CatalogueOption[]> {
    return this.get<CatalogueOption[]>(`${Constants.API_BASE_URL}/admin/product-categories`, {
      search,
    });
  }

  brands(search = ''): Promise<CatalogueOption[]> {
    return this.get<CatalogueOption[]>(`${Constants.API_BASE_URL}/admin/product-brands`, { search });
  }

  units(search = ''): Promise<CatalogueOption[]> {
    return this.get<CatalogueOption[]>(`${Constants.API_BASE_URL}/admin/product-units`, { search });
  }

  taxes(search = ''): Promise<CatalogueOption[]> {
    return this.get<CatalogueOption[]>(`${Constants.API_BASE_URL}/admin/product-taxes`, { search });
  }
}

export const productApi = new ProductApi();
export const productCatalogueApi = new ProductCatalogueApi();
