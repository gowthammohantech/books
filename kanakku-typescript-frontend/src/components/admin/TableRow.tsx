import { useSelector } from 'react-redux';
import { ActionMenu } from '@components/admin/ActionMenu';
import { Button } from '@components/ui';
import { filterByPermission, type Action } from '@components/admin/tableActions';
import type { RootState } from '@store/index';

// Re-export so existing importers of `Action` from TableRow keep working.
export type { Action } from '@components/admin/tableActions';

type TableRowProps<T> = {
  index: number;
  row: T;
  columns: React.ReactNode[];
  actions?: Action<T>[];
  onRowClick?: (row: T) => void;
};

const TableRow = <T,>({ index, row, columns, actions, onRowClick }: TableRowProps<T>) => {
  const permissions = useSelector((state: RootState) => state.systemSettings.data?.permissions) ?? [];

  // Drop actions the current user is not permitted to see, then split into inline + kebab.
  const visibleActions = actions ? filterByPermission(actions, permissions) : [];
  const primaryActions = visibleActions.filter((a) => a.primary);
  const menuActions = visibleActions.filter((a) => !a.primary);

  return (
    <tr
      className={`border-b border-gray-100 transition-colors hover:bg-purple-50/60${onRowClick ? ' cursor-pointer' : ''}`}
      {...(onRowClick ? { onClick: () => onRowClick(row) } : {})}
    >
      <td className="px-3 py-1 text-sm text-gray-700">{index}</td>
      {columns.map((col, colIndex) => (
        <td key={colIndex} className={`px-3 py-1 text-sm text-gray-500 font-medium`}>
          {col}
        </td>
      ))}
      {actions && (
        <td className="px-3 py-1" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-start gap-2">
            {primaryActions.map((action) => {
              const disabled = action.isDisabled ? action.isDisabled(row) : false;
              return (
                <Button
                  key={action.label}
                  size="sm"
                  variant={action.variant === 'danger' ? 'dangerOutline' : 'outline'}
                  disabled={disabled}
                  leftIcon={action.icon}
                  onClick={() => action.onClick(row)}
                >
                  {action.label}
                </Button>
              );
            })}
            {menuActions.length > 0 && <ActionMenu row={row} actions={menuActions} />}
          </div>
        </td>
      )}
    </tr>
  );
};

export default TableRow;
