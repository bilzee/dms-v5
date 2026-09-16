'use client'

import { cn } from '@/lib/utils'

interface TagPillOption {
  id: string
  label: string
  description?: string
}

interface TagPillSelectProps {
  options: TagPillOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  disabled?: boolean
  className?: string
  ['data-testid']?: string
}

export function TagPillSelect({
  options,
  selected,
  onChange,
  disabled = false,
  className,
  'data-testid': dataTestId,
}: TagPillSelectProps) {
  const toggle = (id: string) => {
    if (disabled) return
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div className={cn('flex flex-wrap gap-2', className)} data-testid={dataTestId}>
      {options.map((option) => {
        const isSelected = selected.includes(option.id)
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => toggle(option.id)}
            disabled={disabled}
            title={option.description}
            className={cn(
              'inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
              'border cursor-pointer select-none',
              disabled && 'opacity-50 cursor-not-allowed',
              isSelected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-foreground border-input hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
