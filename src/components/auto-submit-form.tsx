"use client";

import { useRef, type ReactNode } from "react";

/**
 * A GET form that applies filters as soon as a select or checkbox changes.
 * Search boxes still wait for Enter. Works as a plain form without JavaScript.
 */
export function AutoSubmitForm({ action, className, children }: { action: string; className?: string; children: ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      action={action}
      className={className}
      onChange={(e) => {
        const target = e.target as EventTarget;
        if (!(target instanceof HTMLInputElement && target.type === "search")) form.current?.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
