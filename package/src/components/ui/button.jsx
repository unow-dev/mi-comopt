import * as React from "react";
import { cva } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border-2 border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-[1.5px] active:not-aria-[haspopup]:scale-[0.97] active:not-aria-[haspopup]:duration-75 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-y2k-lemon text-y2k-ink border-y2k-ink hover:bg-y2k-pink",
        pink: "bg-y2k-pink text-y2k-ink border-y2k-ink hover:bg-y2k-lemon",
        blue: "bg-y2k-blue text-y2k-ink border-y2k-ink hover:bg-y2k-lilac",
        mint: "bg-y2k-mint text-y2k-ink border-y2k-ink hover:bg-y2k-blue",
        lilac: "bg-y2k-lilac text-y2k-ink border-y2k-ink hover:bg-y2k-pink",
        lemon: "bg-y2k-lemon text-y2k-ink border-y2k-ink hover:bg-y2k-mint",
        outline:
          "border-y2k-ink bg-card text-y2k-ink hover:bg-y2k-panel",
        secondary:
          "bg-y2k-panel text-y2k-ink border-y2k-ink hover:bg-y2k-blue",
        ghost:
          "border-transparent bg-transparent text-y2k-ink hover:bg-y2k-panel",
        destructive:
          "bg-destructive text-y2k-ink border-y2k-ink hover:bg-y2k-ink hover:text-y2k-lemon",
        link: "border-transparent bg-transparent text-y2k-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-4",
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-md px-3 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-5 [&_svg:not([class*='size-'])]:size-5",
        icon: "size-9 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-md",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  loadingText,
  leadingIcon,
  trailingIcon,
  children,
  disabled,
  ...props
}) {
  const Comp = asChild ? Slot : "button";
  const isDisabled = disabled || loading;

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading ? (
        <>
          <Loader2Icon
            data-slot="button-spinner"
            className="size-[1em] animate-spin"
            aria-hidden
          />
          {loadingText ?? children}
        </>
      ) : (
        <>
          {leadingIcon && (
            <span data-slot="button-leading-icon" className="contents">
              {leadingIcon}
            </span>
          )}
          {children}
          {trailingIcon && (
            <span data-slot="button-trailing-icon" className="contents">
              {trailingIcon}
            </span>
          )}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
