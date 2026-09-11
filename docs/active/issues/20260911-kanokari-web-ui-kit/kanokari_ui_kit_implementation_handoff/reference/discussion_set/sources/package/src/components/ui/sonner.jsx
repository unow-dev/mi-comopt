import { Toaster as SonnerToaster } from "sonner";

import { cn } from "@/lib/utils";

function Toaster({ toastOptions, className, ...props }) {
  return (
    <SonnerToaster
      closeButton
      className={cn("toaster group", className)}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "border-2 border-y2k-ink rounded-[6px] bg-card " +
            "p-0 overflow-hidden relative max-w-sm w-full " +
            "shadow-[3px_3px_0px_0px_var(--y2k-ink)] " +
            "transition-none transform-none " +
            "active:scale-100 active:bg-card active:opacity-100 " +
            "hover:scale-100 hover:bg-card hover:opacity-100 " +
            "before:content-[''] before:absolute before:inset-x-0 before:top-0 " +
            "before:h-[22px] before:z-10 before:border-b-2 before:border-y2k-ink",
          title:
            "relative z-20 flex h-[22px] w-full items-center pl-2 pr-2 text-[10px] font-black uppercase tracking-wider text-y2k-ink",
          description: "px-3 py-2 text-xs leading-relaxed text-y2k-ink/80",
          closeButton:
            "absolute right-[5px] top-[3px] z-30 flex size-[14px] items-center justify-center border-0 bg-transparent text-y2k-ink cursor-pointer hover:text-y2k-pink",
          icon: "hidden",
          content: "flex flex-col gap-0",
          success: "before:bg-y2k-lemon",
          error: "before:bg-destructive",
          info: "before:bg-y2k-blue",
          warning: "before:bg-y2k-lilac",
          actionButton:
            "mx-3 mb-3 rounded-[4px] border-2 border-y2k-ink bg-y2k-lemon px-2.5 py-1 text-xs font-bold text-y2k-ink hover:bg-y2k-pink hover:text-y2k-ink active:scale-95",
          cancelButton:
            "mx-3 mb-3 rounded-[4px] border-2 border-y2k-ink bg-card px-2.5 py-1 text-xs text-y2k-ink hover:bg-y2k-panel active:scale-95",
        },
        ...toastOptions,
      }}
      {...props}
    />
  );
}

export { Toaster };
