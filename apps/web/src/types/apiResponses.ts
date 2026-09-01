/**
 * Response envelopes for endpoints consumed from src/api/.
 *
 * These lived inside the page components that happened to be their first
 * caller, so src/api/ imported types FROM @pages/ — an inversion that a package
 * boundary would reject and that made the two api modules depend on a whole
 * screen to describe a payload shape.
 */
import type { Pagination } from '@models/common';
import type { ExpenseCategoryShape } from '@models/expense';
import type { ModuleList } from '@models/role-permissions';

export type ModuleListResponse = {
  success: boolean;
  message: string;
  data: ModuleList[];
};

export interface ExpenseCategoryResponse {
  success: boolean;
  message: string;
  data: {
    categories: ExpenseCategoryShape[];
    pagination: Pagination;
  };
}
