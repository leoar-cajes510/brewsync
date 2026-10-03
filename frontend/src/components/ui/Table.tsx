import type { ReactNode } from 'react';
import EmptyState from './EmptyState';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  /** Replaces the default empty state. */
  empty?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
}

export default function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyTitle = 'No records yet',
  empty,
  rowClassName,
}: TableProps<T>) {
  if (rows.length === 0) return <>{empty ?? <EmptyState title={emptyTitle} />}</>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align, width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={[onRowClick && 'table__row--clickable', rowClassName?.(row)].filter(Boolean).join(' ') || undefined}
            >
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align }}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
