import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans font-semibold transition-[background-color,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-action text-action-ink shadow-sheet hover:bg-action/90",
        secondary: "border border-rule bg-sheet text-ink hover:border-ink/30 hover:bg-paper",
        ghost: "text-ink-soft hover:bg-ink/5 hover:text-ink",
        marker: "bg-highlight text-highlight-ink hover:bg-highlight/85",
        danger: "text-redline hover:bg-redline/10",
      },
      size: {
        sm: "h-8 rounded-control px-3 text-xs",
        md: "h-10 rounded-control px-4 text-sm",
        lg: "h-12 rounded-control px-6 text-base",
        icon: "size-9 rounded-control",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";
