/**
 * Tree-shaken ApexCharts bootstrap for Finch (ApexCharts v6).
 *
 * Per the ApexCharts tree-shaking reference, the full `apexcharts` bundle is
 * replaced by the core wrapper variant plus only the chart-type entries and
 * features the Dashboard actually uses:
 *
 *   - `react-apexcharts/core`  wrapper (same reactive props / lifecycle)
 *   - `apexcharts/area`        registers line, area, scatter, bubble, rangeArea
 *   - `apexcharts/pie`         registers pie, donut, polarArea
 *   - `features/legend`        interactive legend (donut)
 *   - `features/keyboard`      keyboard navigation (UXDS 9.27 / 9.28
 *                              accessibility requirements)
 *
 * All Dashboard chart components MUST import Chart from this module so the
 * app never mixes the full bundle with per-type entries (that duplication is
 * the reference's Common Pitfall #2). New chart types added later must
 * register their entry point HERE (missing feature imports fail silently —
 * reference Common Pitfall #1).
 *
 * `vite.config.ts` lists every entry below in `optimizeDeps.include`
 * (reference: "Vite duplicate bundle issue").
 */
import Chart from 'react-apexcharts/core';
import 'apexcharts/area';
import 'apexcharts/pie';
import 'apexcharts/features/legend';
import 'apexcharts/features/keyboard';

export default Chart;
