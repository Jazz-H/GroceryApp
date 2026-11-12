import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui Button, sized and colored like Stocked's buttons (40px, 44px icon buttons). */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-bold transition-[color,background-color,opacity] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        destructive: 'bg-destructive text-white hover:opacity-90',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        link: 'text-primary font-semibold hover:underline underline-offset-4',
        'destructive-link': 'text-destructive font-semibold hover:underline underline-offset-4',
      },
      size: {
        default: 'h-10 rounded-[12px] px-4 text-[0.92rem]',
        sm: 'h-8 rounded-[9px] px-[11px] text-[0.8rem]',
        lg: 'h-12 rounded-md px-[22px] text-base',
        icon: 'size-11 rounded-md',
        inline: 'h-auto px-1 py-1.5 text-[0.92rem]',
      },
    },
    compoundVariants: [
      { variant: 'link', size: 'default', className: 'px-1' },
      { variant: 'destructive-link', size: 'default', className: 'px-1' },
    ],
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
