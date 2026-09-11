import * as React from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Collapsible({ ...props }) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ className, children, ...props }) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "group flex w-full items-center gap-2 rounded-[4px] border-2 border-y2k-ink px-3 py-2 text-sm font-bold text-y2k-ink",
        "transition-colors hover:bg-y2k-lilac data-[state=open]:bg-y2k-lilac",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-y2k-pink",
        className,
      )}
      {...props}
    >
      <ChevronRightIcon className="size-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
      <span className="flex-1 text-left">{children}</span>
    </CollapsiblePrimitive.Trigger>
  );
}

function CollapsibleContent({ className, ...props }) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden rounded-[4px] border-2 border-t-0 border-y2k-ink bg-card text-sm text-y2k-ink",
        "data-[state=open]:animate-in data-[state=open]:slide-in-from-top-1 data-[state=open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top-1 data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    >
      <div className="p-3">{props.children}</div>
    </CollapsiblePrimitive.Content>
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
