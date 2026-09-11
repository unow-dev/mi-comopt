import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex items-center justify-center rounded-md border-2 border-y2k-ink text-sm font-bold text-y2k-ink transition-all hover:bg-y2k-blue/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-y2k-pink disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-card",
        outline: "bg-transparent",
        pink: "bg-y2k-pink/20 hover:bg-y2k-pink/40",
        blue: "bg-y2k-blue/20 hover:bg-y2k-blue/40",
        mint: "bg-y2k-mint/25 hover:bg-y2k-mint/45",
        lemon: "bg-y2k-lemon/25 hover:bg-y2k-lemon/45",
      },
      size: {
        sm: "h-7 px-2 text-xs",
        md: "h-9 px-3",
        lg: "h-10 px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

const Toggle = React.forwardRef(function Toggle(
  { className, variant, size, pressed, onPressedChange, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      data-slot="toggle"
      data-state={pressed ? "on" : "off"}
      className={cn(
        toggleVariants({ variant, size }),
        pressed && "bg-y2k-lemon shadow-[2px_2px_0_var(--y2k-ink)] translate-x-[-2px] translate-y-[-2px]",
        className,
      )}
      onClick={() => onPressedChange?.(!pressed)}
      {...props}
    >
      {children}
    </button>
  );
});
Toggle.displayName = "Toggle";

export { Toggle, toggleVariants };
