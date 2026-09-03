/**
 * CRUD over one REST path.
 *
 * WHY: `constants/api.ts` holds 417 keys for 252 distinct URLs. The surplus is
 * one key per verb against the same resource —
 *
 *   FETCH_UNITS_URL:  `${API_BASE_URL}/admin/units`,
 *   CREATE_UNIT_URL:  `${API_BASE_URL}/admin/units`,
 *   GET_UNIT_URL:     `${API_BASE_URL}/admin/units`,
 *   UPDATE_UNIT_URL:  `${API_BASE_URL}/admin/units`,
 *   DELETE_UNIT_URL:  `${API_BASE_URL}/admin/units`,
 *
 * — and `/admin/invoices` appears under thirteen of them. A subclass declaring
 * one `path` replaces the set.
 *
 * IT IS A SUPERSET OF THE SHAPE ALREADY HERE. `api/customFieldTypeApi.ts` and
 * `api/expenseCategoryApi.ts` were already doing this by hand — import the
 * client, take a typed generic, return `res.data` — for two resources. Those two
 * are the pattern; this generalises them rather than replacing them, and they
 * can move across when someone touches them.
 *
 * `constants/api.ts` KEEPS ITS KEYS. Deleting one before its last caller has
 * moved is a build break, and there are 570 call sites. The constants stay as
 * aliases until a resource's callers are all on its class.
 */
import { ApiClient, type QueryParams } from './ApiClient';

/** Pagination as the backend sends it, nested inside `data`. */
export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListParams extends QueryParams {
  page?: number;
  limit?: number;
  search?: string;
}

/**
 * A list response.
 *
 * The rows sit under a resource-named key (`units`, `invoices`, …) beside
 * `pagination`, so a subclass names its own key rather than this pretending
 * there is one convention.
 */
export type ListResponse<T> = { pagination: Pagination } & Record<string, T[] | Pagination>;

export abstract class ResourceApi<T, TCreate = Partial<T>, TUpdate = Partial<T>> extends ApiClient {
  /** The collection URL, e.g. `/api/admin/products`. */
  protected abstract readonly path: string;

  /** The key the backend nests this resource's rows under in a list response. */
  protected abstract readonly listKey: string;

  /** A page of rows plus its pagination. */
  async list(params?: ListParams): Promise<{ rows: T[]; pagination: Pagination }> {
    const data = await this.get<ListResponse<T>>(this.path, params);
    return {
      rows: (data?.[this.listKey] as T[]) ?? [],
      pagination: (data?.pagination as Pagination) ?? {
        total: 0,
        page: 1,
        limit: 0,
        totalPages: 0,
      },
    };
  }

  async byId(id: string): Promise<T> {
    return await this.get<T>(`${this.path}/${id}`);
  }

  async create(dto: TCreate): Promise<T> {
    return await this.post<T>(this.path, dto);
  }

  async update(id: string, dto: TUpdate): Promise<T> {
    return await this.put<T>(`${this.path}/${id}`, dto);
  }

  async remove(id: string): Promise<void> {
    await this.delete<void>(`${this.path}/${id}`);
  }
}
