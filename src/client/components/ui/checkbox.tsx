import * as React from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, onCheckedChange, ...props }, ref) => {
    const localRef = React.useRef<HTMLInputElement>(null)
    React.useImperativeHandle(ref, () => localRef.current as HTMLInputElement)
    React.useEffect(() => {
      if (localRef.current) localRef.current.indeterminate = !!indeterminate
    }, [indeterminate])

    return (
      <span
        data-slot="checkbox"
        className={cn(
          'relative inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input text-primary shadow-sm',
          props.checked ? 'bg-primary border-primary' : 'bg-background',
          indeterminate && 'bg-primary border-primary',
          props.disabled && 'opacity-50',
          className,
        )}
      >
        {props.checked && <Check className="size-3 text-primary-foreground" aria-hidden />}
        {indeterminate && <Minus className="size-3 text-primary-foreground" aria-hidden />}
        <input
          ref={localRef}
          type="checkbox"
          role="checkbox"
          className="absolute inset-1/2 m-0 size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer appearance-none opacity-0"
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          {...props}
        />
      </span>
    )
  },
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
