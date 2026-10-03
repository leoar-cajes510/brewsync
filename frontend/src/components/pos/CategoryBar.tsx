import Tabs, { type TabItem } from '../ui/Tabs';

interface CategoryBarProps {
  items: TabItem[];
  value: string;
  onChange: (categoryId: string) => void;
}

// Horizontal category chips; only this strip scrolls sideways when it overflows.
export default function CategoryBar({ items, value, onChange }: CategoryBarProps) {
  return (
    <div className="category-bar">
      <Tabs items={items} value={value} onChange={onChange} variant="chips" />
    </div>
  );
}
