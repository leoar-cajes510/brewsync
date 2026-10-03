import type { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';

interface SearchBarProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  shortcut?: string;
}

export default function SearchBar({ shortcut, className = '', ...rest }: SearchBarProps) {
  return (
    <div className={`search-bar ${className}`}>
      <Search size={16} className="search-bar__icon" />
      <input type="search" className="search-bar__input" {...rest} />
      {shortcut && <kbd className="search-bar__kbd">{shortcut}</kbd>}
    </div>
  );
}
