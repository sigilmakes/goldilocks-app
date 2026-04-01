/**
 * Reusable skeleton loading components.
 * All use the animate-pulse bg-slate-700 pattern matching the dark theme.
 */

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

/** Basic pulsing rectangle with configurable width/height. */
export function Skeleton({ className = '', width, height }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-slate-700 rounded ${className}`}
      style={{ width, height }}
    />
  );
}

/** Mimics ConversationItem shape: icon circle + 2 text lines. */
export function ConversationSkeleton() {
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <div className="w-4 h-4 bg-slate-700 rounded animate-pulse mt-0.5 flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-slate-700 rounded animate-pulse w-3/4" />
        <div className="h-3 bg-slate-700 rounded animate-pulse w-1/2" />
      </div>
    </div>
  );
}

/** Multiple ConversationSkeleton items for a list. */
export function ConversationListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <ConversationSkeleton key={i} />
      ))}
    </div>
  );
}

/** Mimics FileItem shape: icon + filename + size. */
export function FileSkeleton() {
  return (
    <div className="flex items-center gap-2 p-2 bg-slate-700/50 rounded-lg">
      <div className="w-4 h-4 bg-slate-700 rounded animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 bg-slate-700 rounded animate-pulse w-2/3" />
        <div className="h-3 bg-slate-700 rounded animate-pulse w-1/4" />
      </div>
    </div>
  );
}

/** Multiple FileSkeleton items. */
export function FileListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <FileSkeleton key={i} />
      ))}
    </div>
  );
}

/** Mimics chat message bubbles with varying widths (3-4 messages). */
export function ChatSkeleton() {
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* User message */}
      <div className="flex gap-3 justify-end">
        <div className="max-w-[60%] space-y-2">
          <div className="h-4 bg-slate-700 rounded animate-pulse w-48" />
          <div className="h-4 bg-slate-700 rounded animate-pulse w-32" />
        </div>
      </div>

      {/* Assistant message */}
      <div className="flex gap-3">
        <div className="w-8 h-8 bg-slate-700 rounded-full animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-700 rounded animate-pulse w-full" />
          <div className="h-4 bg-slate-700 rounded animate-pulse w-5/6" />
          <div className="h-4 bg-slate-700 rounded animate-pulse w-3/4" />
        </div>
      </div>

      {/* Another user message */}
      <div className="flex gap-3 justify-end">
        <div className="max-w-[60%] space-y-2">
          <div className="h-4 bg-slate-700 rounded animate-pulse w-56" />
        </div>
      </div>

      {/* Another assistant message */}
      <div className="flex gap-3">
        <div className="w-8 h-8 bg-slate-700 rounded-full animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-700 rounded animate-pulse w-full" />
          <div className="h-4 bg-slate-700 rounded animate-pulse w-2/3" />
        </div>
      </div>
    </div>
  );
}

/** Skeleton for model selector in header. */
export function ModelSelectorSkeleton() {
  return (
    <div className="h-8 w-44 bg-slate-700 rounded-lg animate-pulse" />
  );
}
