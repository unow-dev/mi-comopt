import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded border-2 border-y2k-ink px-2 py-0.5 text-xs font-semibold leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "bg-card text-y2k-ink",
        blue: "bg-y2k-blue text-y2k-ink",
        pink: "bg-y2k-pink text-y2k-ink",
        lilac: "bg-y2k-lilac text-y2k-ink",
        mint: "bg-y2k-mint text-y2k-ink",
        lemon: "bg-y2k-lemon text-y2k-ink",
        outline: "border-dashed bg-transparent",
      },
      size: {
        sm: "text-[10px] px-1.5",
        md: "text-xs",
        lg: "text-sm px-2.5 py-1",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

function Badge({ className, variant, size, ...props }) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      data-size={size}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
