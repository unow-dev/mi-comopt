import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Label({ className, ...props }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "inline-flex items-center gap-1 text-sm font-medium leading-none text-y2k-ink select-none group-data-disabled:pointer-events-none group-data-disabled:opacity-50 peer-data-disabled:pointer-events-none peer-data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
