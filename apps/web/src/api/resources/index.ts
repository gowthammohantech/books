/**
 * The API layer's public surface.
 *
 * Barrels are otherwise absent from this codebase — `tsconfig.base.json` says
 * deliberately that packages declare their own paths and do not re-export across
 * boundaries. This one earns its place because the alternative is every screen
 * importing a singleton by its file path, and the point of the layer is that a
 * screen asks for `invoiceApi`, not for a module location.
 *
 * ADOPTION IS INCREMENTAL BY DESIGN. Two of these resources exist today
 * (`api/customFieldTypeApi.ts`, `api/expenseCategoryApi.ts`) in the older
 * function-per-endpoint shape and still work; 570 call sites still read
 * `constants/api.ts` directly. Nothing here breaks either, because
 * `constants/api.ts` keeps all 417 keys until their last caller has moved.
 */
export { ApiClient } from '../core/ApiClient';
export type { ApiEnvelope, QueryParams } from '../core/ApiClient';
export { ApiError, toApiError, errorMessage } from '../core/ApiError';
export { ResourceApi } from '../core/ResourceApi';
export type { ListParams, Pagination } from '../core/ResourceApi';
export { qk } from '../core/queryKeys';

export { ProductApi, ProductCatalogueApi, productApi, productCatalogueApi } from './ProductApi';
export type { ProductRow, ProductListParams, CatalogueOption } from './ProductApi';

export { InvoiceApi, invoiceApi } from './InvoiceApi';
export type {
  InvoiceRow,
  InvoicePaymentRow,
  InvoiceListParams,
  ActivityEntryDto,
} from './InvoiceApi';
