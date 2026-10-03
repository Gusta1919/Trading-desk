/**
 * The desk's building blocks. Every tab is made of these, so the same thing looks the
 * same everywhere: a page header, panels with one kind of title, one kind of number, one
 * kind of label, one kind of switch.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/**
 * The delay for the i-th item of a list that rises in one after another — the same
 * rhythm everywhere, capped so long lists never keep you waiting.
 */
export const stagger = (i: number, step = 45, max = 700): CSSProperties => ({
  animationDelay: `${Math.min(i * step, max)}ms`,
});

/* ── Page structure ──────────────────────────────────────────────────── */

/** The top of every tab: what it is, one line on what it is for, and its own controls. */
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="anim-rise flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-heading font-semibold">{title}</h1>
        {/* Always one line: written short, and cut with an ellipsis rather than wrapped. */}
        {sub && <p className="mt-1 truncate text-small text-soft">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * A panel: the one card the desk uses for a block of content. Its title is always the
 * same size and weight, its subtitle always one quiet line, its controls on the right.
 */
export function Panel({
  title,
  sub,
  action,
  children,
  index = 0,
  id,
  flush = false,
  className,
  style,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** Its place in the page, so panels rise in one after another. */
  index?: number;
  id?: string;
  /** Content runs to the panel's edges (tables, charts); the title keeps its padding. */
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section id={id} className={cx("card anim-rise scroll-mt-24", className)} style={{ ...stagger(index, 70), ...style }}>
      {(title || action) && (
        <div className={cx("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-6 pt-5", flush ? "pb-4" : "pb-4")}>
          <div className="min-w-0">
            {title && <h2 className="text-title font-semibold">{title}</h2>}
            {sub && <p className="mt-0.5 text-small text-faint">{sub}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={cx(flush ? "" : "px-6 pb-5", !title && !action && !flush && "pt-5")}>{children}</div>
    </section>
  );
}

/** A value with its label: the one way a number is shown on its own. */
export function Stat({
  label,
  value,
  sub,
  tone,
  size = "stat",
  hint,
  className,
  style,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** A Tailwind text colour for the value — green, red, or nothing. */
  tone?: string;
  size?: "body" | "title" | "stat" | "display";
  /** What the number means, one hover away. */
  hint?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const valueSize = { body: "text-body", title: "text-title", stat: "text-stat", display: "text-display" }[size];
  return (
    <div className={cx("min-w-0", className)} style={style}>
      {hint ? (
        <Tip text={hint} className="eyebrow block truncate">
          {label}
        </Tip>
      ) : (
        <div className="eyebrow truncate">{label}</div>
      )}
      <div
        className={cx(
          "num mt-1 truncate font-medium",
          valueSize,
          tone,
          tone === "text-up" && size !== "body" && "glow-up",
          tone === "text-down" && size !== "body" && "glow-down",
        )}
      >
        {value}
      </div>
      {sub && <div className="num mt-0.5 truncate text-caption text-faint">{sub}</div>}
    </div>
  );
}

/**
 * A form field: its label above, the control, and an optional hint under it. A div, not a
 * <label>: a label forwards clicks to its first control, which would press "Yes" on a
 * click of the words above a Yes/No.
 */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="eyebrow mb-2">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-caption text-faint">{hint}</div>}
    </div>
  );
}

/** Nothing to show yet — said plainly, with the way forward. */
export function Empty({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("anim-fade flex flex-col items-center gap-2 px-6 py-14 text-center", className)}>
      <p className="text-title font-medium">{title}</p>
      {body && <p className="max-w-md text-body text-soft">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ── Controls ────────────────────────────────────────────────────────── */

export interface SegmentOption<T> {
  value: T;
  label: ReactNode;
  /** A word after the label, quieter. */
  hint?: string;
  icon?: ReactNode;
  /** A thin line of colour under the picked option — a hint, never the whole fill. */
  colour?: string;
  title?: string;
}

/**
 * A row of choices with a thumb that glides to the one picked — tabs, filters, Yes and
 * No, Long and Short. The picked option gets a raised background; colour is only a
 * hint, a thin line under the thumb. `fill` stretches the options to equal widths.
 */
export function Segmented<T extends string | number | boolean>({
  options,
  value,
  onChange,
  allowNone = false,
  size = "md",
  fill = false,
  className,
}: {
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
  allowNone?: boolean;
  size?: "sm" | "md";
  fill?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const index = options.findIndex((o) => o.value === value);
  const picked = index >= 0 ? options[index] : null;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const btn = index >= 0 ? (el.children[index + 1] as HTMLElement | undefined) : undefined;
      setThumb(btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, options.length]);

  return (
    <div
      ref={box}
      role="radiogroup"
      className={cx(
        "relative rounded-xl bg-subtle p-1",
        fill ? "grid" : "inline-flex flex-wrap",
        className,
      )}
      style={fill ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 rounded-lg bg-raised shadow-[inset_0_0_0_1px_var(--color-line),0_6px_18px_rgb(0_0_0/0.35)]"
        style={{
          left: thumb?.left ?? 0,
          width: thumb?.width ?? 0,
          opacity: thumb ? 1 : 0,
          transition: "left 480ms var(--ease-slow), width 480ms var(--ease-slow), opacity 280ms var(--ease-slow)",
        }}
      >
        <span
          className="absolute bottom-[3px] left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full"
          style={{
            backgroundColor: picked?.colour ?? "transparent",
            boxShadow: picked?.colour ? `0 0 8px ${picked.colour}` : undefined,
            transition: "background-color 480ms var(--ease-slow)",
          }}
        />
      </span>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(on && allowNone ? null : o.value)}
            className={cx(
              "relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium",
              "transition-[color,transform] duration-300 active:scale-[0.97]",
              size === "sm" ? "px-3 py-1.5 text-small" : "px-3.5 py-2 text-body",
              on ? "text-ink" : "text-soft hover:text-ink",
            )}
          >
            {o.icon && (
              <span className="flex transition-colors duration-500" style={{ color: on && o.colour ? o.colour : "var(--color-faint)" }}>
                {o.icon}
              </span>
            )}
            <span>
              {o.label}
              {o.hint && <span className="ml-1.5 text-caption font-normal text-faint">{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Yes, No — or nothing yet. */
export function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <Segmented
      fill
      allowNone
      value={value}
      onChange={onChange}
      options={[
        { value: true, label: "Yes" },
        { value: false, label: "No" },
      ]}
    />
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
            aria-pressed={active}
            onClick={() => onChange(active ? value.filter((v) => v !== o) : [...value, o])}
            className={cx(
              "rounded-full border px-3 py-1 text-small transition-[color,background-color,border-color,transform] duration-300 active:scale-[0.97]",
              active ? "border-ink/80 bg-ink text-bg" : "text-soft hover:border-soft/50 hover:text-ink",
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
   * Rendered into <body> on purpose. A `fixed` element positions against the nearest
   * transformed ancestor, not the viewport — and the tab transition animates a transform.
   */
  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* A flex wrapper with min-h-full centres the panel but still lets a tall one scroll from the top. */}
      <div className="flex min-h-full justify-center p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={cx("anim-pop m-auto w-full rounded-2xl border bg-raised", width)} style={{ boxShadow: "var(--shadow-modal)" }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "accent" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-xl font-medium",
        size === "sm" ? "px-3 py-1.5 text-small" : "px-4 py-2 text-body",
        "transition-[transform,background-color,box-shadow,color,border-color] duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
        variant === "primary" && "bg-ink text-bg hover:bg-ink/88",
        variant === "accent" && "accent-outline font-semibold",
        variant === "ghost" && "text-soft hover:bg-subtle hover:text-ink",
        variant === "danger" && "text-down hover:bg-down/10",
        className,
      )}
    />
  );
}

export function Pill({
  children,
  tone: t = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "up" | "down" | "accent" | "warn";
  className?: string;
}) {
  return (
    <span
      className={cx(
        "pill",
        t === "neutral" && "border-line text-soft",
        t === "up" && "border-up/30 text-up",
        t === "down" && "border-down/30 text-down",
        t === "accent" && "border-accent/30 text-accent-2",
        t === "warn" && "border-warn/30 text-warn",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A decimal field that keeps what you type. A controlled number input would turn "0."
 * back into "0" mid-keystroke; this holds the text and reports a number only when the
 * text is one, taking outside changes only when they differ from it.
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
        className={cx("field num disabled:opacity-40", suffix && "pr-9")}
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
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-small text-faint">{suffix}</span>
      )}
    </div>
  );
}

/**
 * The reasoning behind a label, one hover away. Portalled to <body> for the same reason
 * as Modal, and opened by keyboard focus too, so it never depends on a mouse.
 */
export function Tip({ text, children, className }: { text: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<DOMRect | null>(null);
  if (!text) return <span className={className}>{children}</span>;

  const show = () => setAt(ref.current?.getBoundingClientRect() ?? null);
  const hide = () => setAt(null);
  // Open above unless that would leave the viewport; keep off either edge.
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
            className="anim-fade pointer-events-none fixed z-[80] w-max max-w-[320px] rounded-lg border bg-raised px-3 py-2 text-small normal-case leading-snug tracking-normal text-soft"
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

/* ── Hooks ───────────────────────────────────────────────────────────── */

/** Counts a number up from zero — used once, when a value first appears. */
export function useCountUp(target: number | null, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(target);
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / ms, 1);
      setV(target * (1 - (1 - t) ** 3));
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
 * Measures an element so charts fill whatever width they're given. Measured on mount:
 * ResizeObserver callbacks ride on animation frames, which browsers throttle.
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
