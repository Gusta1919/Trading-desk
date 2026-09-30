import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/**
 * The delay for the i-th item of a list that rises in one after another — the same
 * rhythm as the wire and the journal, capped so long lists never keep you waiting.
 */
export const stagger = (i: number, step = 35, max = 700) => ({
  animationDelay: `${Math.min(i * step, max)}ms`,
});

/** A row of pill buttons where one (or none) is selected. */
export function Segmented<T extends string | number | boolean>({
  options,
  value,
  onChange,
  allowNone = false,
  size = "md",
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
  allowNone?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-subtle p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(active && allowNone ? null : o.value)}
            className={cx(
              "rounded-lg font-medium transition-[color,background-color,box-shadow] duration-500 ease-[cubic-bezier(0.25,1,0.5,1)]",
              size === "sm" ? "px-3 py-1.5 text-[12px]" : "px-3.5 py-2 text-[13px]",
              active
                ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line),0_6px_20px_rgb(0_0_0/0.35)]"
                : "text-soft hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Toggle chips for picking several values (e.g. mistakes). */
export function Chips({
  options,
  value,
  onChange,
  labelOf,
  titleOf,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  /** Shown instead of the raw value, for options stored as ids. */
  labelOf?: (o: string) => string;
  titleOf?: (o: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            title={titleOf?.(o)}
            onClick={() =>
              onChange(active ? value.filter((v) => v !== o) : [...value, o])
            }
            className={cx(
              "rounded-full border px-3 py-1 text-[12px] transition-[color,background-color,border-color,transform] duration-200 active:scale-[0.97]",
              active
                ? "border-ink bg-ink text-bg shadow-[0_2px_8px_rgb(0_0_0/0.18)]"
                : "text-soft hover:border-soft hover:text-ink",
            )}
          >
            {labelOf?.(o) ?? o}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  width = "max-w-3xl",
  children,
}: {
  open: boolean;
  onClose: () => void;
  width?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  /*
   * Rendered into <body> on purpose. A `fixed` element positions against the
   * nearest transformed ancestor, not the viewport — and the tab transition
   * animates a transform, which was cropping the modal to the page content.
   */
  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* A flex wrapper with min-h-full centres the panel but still lets a tall
          one scroll from the top instead of being clipped. */}
      <div
        className="flex min-h-full justify-center p-6"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          className={cx("anim-pop m-auto w-full rounded-2xl border bg-raised", width)}
          style={{ boxShadow: "var(--shadow-modal)" }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "accent" | "ghost" | "danger";
}) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-medium",
        "transition-[transform,background-image,filter,box-shadow,color] duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] active:scale-[0.98] disabled:opacity-50",
        variant === "primary" && "bg-ink text-bg hover:bg-ink/88",
        variant === "accent" && "accent-outline font-semibold",
        variant === "ghost" && "text-soft hover:bg-subtle hover:text-ink",
        variant === "danger" && "text-down hover:bg-down/10",
        className,
      )}
    />
  );
}

/** Counts a number up from zero — used once, when a value first appears. */
export function useCountUp(target: number | null, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(target);
    const from = 0;
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / ms, 1);
      setV(from + (target - from) * (1 - (1 - t) ** 3));
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    // Background tabs throttle frames; never leave a number stranded short of its value.
    const failsafe = window.setTimeout(() => {
      cancelAnimationFrame(id);
      setV(target);
    }, ms + 400);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(failsafe);
    };
  }, [target, ms]);
  return target == null ? null : v;
}

/**
 * Measures an element so charts fill whatever width they're given.
 * Measures synchronously on mount: ResizeObserver callbacks ride on animation frames,
 * which browsers throttle — so relying on it alone can leave a chart at its default size.
 */
export function useWidth(fallback = 720) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return [ref, width || fallback] as const;
}

/** A from–to slider: two handles on one track. */
export function RangeSlider({
  min,
  max,
  step,
  from,
  to,
  onChange,
  format = (v) => String(v),
}: {
  min: number;
  max: number;
  step: number;
  from: number;
  to: number;
  onChange: (from: number, to: number) => void;
  format?: (v: number) => string;
}) {
  const pos = (v: number) => ((v - min) / (max - min || 1)) * 100;

  return (
    <div className="w-full max-w-sm">
      <div className="num mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="font-medium">
          {format(from)} – {format(to)}
        </span>
        <span className="text-[11px] text-faint">
          {format(min)} … {format(max)}
        </span>
      </div>

      <div className="range-pair relative h-4">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-subtle" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink/70"
          style={{ left: `${pos(from)}%`, right: `${100 - pos(to)}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={from}
          onChange={(e) => onChange(Math.min(Number(e.target.value), to), to)}
          className="absolute inset-0 w-full"
          aria-label="Minimum"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={to}
          onChange={(e) => onChange(from, Math.max(Number(e.target.value), from))}
          className="absolute inset-0 w-full"
          aria-label="Maximum"
        />
      </div>
    </div>
  );
}

/** A switch — used where a tick-box would feel cheap. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        "group flex h-full w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left",
        "transition-[background-color,border-color,transform] duration-200 active:scale-[0.99]",
        checked
          ? "border-up/40 bg-up/[0.07]"
          : "hover:border-soft/50 hover:bg-subtle",
      )}
    >
      <span
        className={cx(
          "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-up" : "bg-subtle ring-1 ring-inset ring-line",
        )}
      >
        <span
          className={cx(
            "absolute top-[3px] size-4 rounded-full bg-white shadow-sm transition-all duration-200",
            checked ? "left-[19px]" : "left-[3px] bg-faint",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="block text-[12px] text-faint">{hint}</span>}
      </span>
    </button>
  );
}

export function Pill({
  children,
  tone: t = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "up" | "down" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cx(
        "pill",
        t === "neutral" && "border-line text-soft",
        t === "up" && "border-up/30 text-up",
        t === "down" && "border-down/30 text-down",
        t === "accent" && "border-accent/30 text-accent",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A decimal field that keeps what you type. A controlled number input would turn
 * "0." back into "0" mid-keystroke; this holds the text and reports a number only
 * when the text is one, taking outside changes only when they differ from it.
 */
export function DecimalInput({
  value,
  onChange,
  placeholder,
  suffix,
  className,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  suffix?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    const parsed = parseFloat(text.replace(",", "."));
    const same = value == null ? text.trim() === "" : parsed === value;
    if (!same) setText(value == null ? "" : String(value));
    // Only outside changes matter here; our own keystrokes already match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className={cx("relative", className)}>
      <input
        inputMode="decimal"
        disabled={disabled}
        className={cx("field num disabled:opacity-40", suffix && "pr-8")}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const n = parseFloat(next.replace(",", "."));
          onChange(next.trim() === "" ? null : Number.isFinite(n) ? n : value);
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">
          {suffix}
        </span>
      )}
    </div>
  );
}

/**
 * The reasoning behind a number, one hover away. Portalled to <body> for the same
 * reason as Modal (the tab transition's transform would otherwise crop it), and
 * opened by keyboard focus too, so it never depends on a mouse.
 */
export function Tip({
  text,
  children,
  className,
}: {
  text: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<DOMRect | null>(null);
  if (!text) return <span className={className}>{children}</span>;

  const show = () => setAt(ref.current?.getBoundingClientRect() ?? null);
  const hide = () => setAt(null);
  // Open above unless that would leave the viewport; keep 12px off either edge.
  const above = at ? at.top > 140 : true;
  const x = at ? Math.min(Math.max(at.left + at.width / 2, 172), window.innerWidth - 172) : 0;

  return (
    <span
      ref={ref}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className={cx("cursor-help rounded outline-none focus-visible:ring-1 focus-visible:ring-accent/60", className)}
    >
      {children}
      {at &&
        createPortal(
          <div
            role="tooltip"
            className="anim-fade pointer-events-none fixed z-[80] w-max max-w-[320px] rounded-lg border bg-raised px-3 py-2 text-[12px] leading-snug text-soft"
            style={{
              left: x,
              top: above ? at.top - 8 : at.bottom + 8,
              transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              boxShadow: "var(--shadow-lift)",
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
