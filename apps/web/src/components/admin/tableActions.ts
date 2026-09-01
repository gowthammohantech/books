import { hasPermission } from '@utils/hasPermission';
import type { PermissionSet } from '@models/permissions';

/**
 * A single row action shared by the admin Table components.
 * Backward compatible: without `primary`/`variant`/`requirePermission`, an action renders
 * inside the kebab ActionMenu exactly as before.
 */
export type Action<T> = {
  label: string;
  icon?: React.ReactNode;
  onClick: (row: T) => void;
  /** Optional predicate: if it returns true the action is rendered but disabled */
  isDisabled?: (row: T) => boolean;
  /** Render this action as an inline button at the row end instead of inside the kebab menu */
  primary?: boolean;
  /** Visual treatment for the inline button (danger = destructive styling, e.g. Delete) */
  variant?: 'default' | 'danger';
  /** Hide this action entirely unless the current user has the given module permission */
  requirePermission?: {
    moduleSlug: string;
    action: 'view' | 'create' | 'edit' | 'delete';
  };
};

/**
 * Filter actions by their optional `requirePermission` guard.
 * Actions without a guard always pass. Shared by TableRow (inline buttons) and ActionMenu (kebab),
 * so pages no longer need to hand-roll `.filter(hasPermission(...))` boilerplate.
 */
export const filterByPermission = <T,>(
  actions: Action<T>[],
  permissions: PermissionSet[],
): Action<T>[] =>
  actions.filter((action) =>
    action.requirePermission
      ? hasPermission(permissions, action.requirePermission.moduleSlug, action.requirePermission.action)
      : true,
  );
