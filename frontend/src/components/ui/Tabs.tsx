export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  variant?: 'segmented' | 'chips';
}

// In-page tabs/filters (e.g. Dine-In / Takeout, category chips).
export default function Tabs({ items, value, onChange, variant = 'segmented' }: TabsProps) {
  return (
    <div className={`tabs tabs--${variant}`} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          className={`tabs__tab ${item.value === value ? 'tabs__tab--active' : ''}`}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.count !== undefined && <span className="tabs__count">({item.count})</span>}
        </button>
      ))}
    </div>
  );
}
