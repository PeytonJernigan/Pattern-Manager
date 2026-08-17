import { Search, X } from 'lucide-react'
import { useId, type ChangeEventHandler, type Ref } from 'react'

interface SearchFieldProps {
  value: string
  onChange: ChangeEventHandler<HTMLInputElement>
  onClear?: () => void
  placeholder?: string
  label?: string
  autoFocus?: boolean
  inputRef?: Ref<HTMLInputElement>
}

export function SearchField({
  value,
  onChange,
  onClear,
  placeholder = 'Search…',
  label = 'Search',
  autoFocus = false,
  inputRef,
}: SearchFieldProps) {
  const id = useId()

  return (
    <label className="search-field" htmlFor={id}>
      <span className="sr-only">{label}</span>
      <Search size={19} aria-hidden="true" />
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {value && onClear ? (
        <button type="button" aria-label="Clear search" onClick={onClear}>
          <X size={17} aria-hidden="true" />
        </button>
      ) : (
        <kbd>/</kbd>
      )}
    </label>
  )
}
