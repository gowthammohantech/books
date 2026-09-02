import { useEffect, useRef, useState, type ReactNode } from "react";

export interface ChartFrameSize {
  width: number;
  height: number;
}

export interface ChartFrameProps {
  /** Lower bound of the height clamp. */
  minH?: string;
  /** Viewport-relative preferred height. */
  vh?: string;
  /** Upper bound of the height clamp. */
  maxH?: string;
  /**
   * Width/height ratio the chart must hold (a radial gauge is `1`). The frame
   * then renders at `min(clamped height, width / aspect)` and centres it, so a
   * circular chart stays circular instead of being stretched by its column.
   */
  aspect?: number;
  className?: string;
  /** Rendered once per settled size. The frame supplies the `key`. */
  children: (size: ChartFrameSize) => ReactNode;
}

/**
 * A responsive box for charts.
 *
 * Two problems, one component:
 *
 * 1. **Fixed pixel heights.** Charts were the largest fixed vertical blocks in
 *    the app (2 x 260px on the dashboard alone), which is most of why the pane
 *    could not fit its content at 100% zoom. Height is now
 *    `clamp(min, vh, max)`, so it gives way on a short viewport instead of
 *    forcing a scrollbar.
 *
 * 2. **Stale charts.** ApexCharts only auto-resizes on `window.resize`. Every
 *    container-width change that is not a window resize left the chart at its
 *    old width — collapsing the sidebar (`w-60` <-> `w-16`), or opening the
 *    agent dock, which mounts a `lg:w-[26.25rem]` sibling column. Fixed heights
 *    masked this; fluid ones would not have.
 *
 * The remount-on-resize is deliberate. `react-apexcharts` exposes no chart
 * instance ref, so the supported update path is
 * `ApexCharts.exec(chartId, 'updateOptions', ...)`, which would require every
 * call site to mint and keep a globally unique `chart.id` — including
 * components rendered on more than one page at once. A keyed remount costs one
 * re-render on a settled resize and is library-agnostic.
 */
const ChartFrame = ({
  minH = "10rem",
  vh = "22vh",
  maxH = "16.25rem",
  aspect,
  className = "",
  children,
}: ChartFrameProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ChartFrameSize | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      // Quantised to 8px: a scrollbar appearing, or a sub-pixel layout shift,
      // would otherwise remount the chart on every frame of a resize.
      const width = Math.max(0, Math.round(rect.width / 8) * 8);
      const height = Math.max(0, Math.round(rect.height));
      if (width === 0 || height === 0) return;
      setSize((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height },
      );
    };

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      timer = setTimeout(() => {
        frame = requestAnimationFrame(measure);
      }, 120);
    });

    observer.observe(el);
    measure();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);

  // `min-h-0` so the frame can actually shrink inside a flex column — without
  // it a flex child refuses to go below its content height and the clamp is
  // silently ignored.
  const height = aspect && size ? Math.min(size.height, size.width / aspect) : size?.height;
  const width = aspect && height ? height * aspect : size?.width;

  return (
    <div
      ref={ref}
      className={`w-full min-h-0 ${className}`}
      style={{ height: `clamp(${minH}, ${vh}, ${maxH})` }}
    >
      {/* Nothing is rendered until the first measurement: ApexCharts mounted at
          width 0 draws its "no data" empty state and never recovers. */}
      {size && width && height ? (
        <div key={`${width}x${height}`} style={{ width, height, margin: aspect ? "0 auto" : undefined }}>
          {children({ width, height })}
        </div>
      ) : null}
    </div>
  );
};

export default ChartFrame;
