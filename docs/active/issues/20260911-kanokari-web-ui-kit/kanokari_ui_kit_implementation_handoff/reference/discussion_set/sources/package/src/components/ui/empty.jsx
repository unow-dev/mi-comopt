import * as React from "react";

import { cn } from "@/lib/utils";

function Empty({
  className,
  icon,
  title,
  description,
  action,
  children,
  ...props
}) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-y2k-ink/30 px-6 py-10 text-center",
        className,
      )}
      {...props}
    >
      {icon && (
        <div data-slot="empty-icon" className="text-y2k-ink/50 [&_svg]:size-8">
          {icon}
        </div>
      )}
      {title && (
        <p data-slot="empty-title" className="text-sm font-semibold text-y2k-ink">
          {title}
        </p>
      )}
      {description && (
        <p data-slot="empty-description" className="max-w-xs text-xs text-y2k-ink/60">
          {description}
        </p>
      )}
      {action && <div data-slot="empty-action">{action}</div>}
      {children}
    </div>
  );
}

export { Empty };
