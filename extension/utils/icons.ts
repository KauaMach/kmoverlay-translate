import { applyAttributes } from './dom';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DEFAULT_ICON_SIZE = 20;
const DEFAULT_STROKE_WIDTH = 2;

interface ShapeSpec {
  tag: 'path' | 'circle';
  attributes: Record<string, string>;
}

const path = (d: string): ShapeSpec => ({ tag: 'path', attributes: { d } });
const circle = (cx: number, cy: number, r: number): ShapeSpec => ({
  tag: 'circle',
  attributes: { cx: String(cx), cy: String(cy), r: String(r) },
});

/** Stroke icons used by the design (24x24 grid). */
const ICON_SHAPES = {
  settings: [
    circle(12, 12, 3),
    path(
      'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    ),
  ],
  arrowRight: [path('M5 12h14M13 6l6 6-6 6')],
  alertCircle: [circle(12, 12, 9), path('M12 8v5M12 16.5h.01')],
  check: [path('M20 6 9 17l-5-5')],
  pause: [path('M9 5v14M15 5v14')],
  eye: [path('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z'), circle(12, 12, 3)],
  sliders: [
    path('M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0'),
    circle(16, 6, 2),
    circle(10, 12, 2),
    circle(18, 18, 2),
  ],
  trash: [path('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3')],
  clock: [circle(12, 12, 9), path('M12 7v5l3 2')],
} satisfies Record<string, ShapeSpec[]>;

export type IconName = keyof typeof ICON_SHAPES;

export interface IconOptions {
  size?: number;
  strokeWidth?: number;
  /** Accessible name. Without it the icon is decorative and hidden from assistive technology. */
  label?: string;
}

/** Creates a stroke icon that inherits the current text color. */
export function createIcon(name: IconName, options: IconOptions = {}): SVGSVGElement {
  const svg = createSvgRoot(options.size ?? DEFAULT_ICON_SIZE, options.label);
  applyAttributes(svg, {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': options.strokeWidth ?? DEFAULT_STROKE_WIDTH,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  for (const shape of ICON_SHAPES[name]) {
    const element = document.createElementNS(SVG_NAMESPACE, shape.tag);
    applyAttributes(element, shape.attributes);
    svg.appendChild(element);
  }
  return svg;
}

/**
 * Creates the two-tone loading spinner from the design. The arc uses the
 * current text color and the track a faded copy of it; the rotation comes from
 * the `spinner` CSS class of the component that uses it.
 */
export function createSpinner(size = DEFAULT_ICON_SIZE): SVGSVGElement {
  const svg = createSvgRoot(size);
  applyAttributes(svg, { fill: 'none', class: 'spinner' });
  const track = document.createElementNS(SVG_NAMESPACE, 'circle');
  applyAttributes(track, {
    cx: '12',
    cy: '12',
    r: '9',
    stroke: 'currentColor',
    'stroke-opacity': '0.3',
    'stroke-width': '3',
  });
  const arc = document.createElementNS(SVG_NAMESPACE, 'path');
  applyAttributes(arc, {
    d: 'M21 12a9 9 0 0 0-9-9',
    stroke: 'currentColor',
    'stroke-width': '3',
    'stroke-linecap': 'round',
  });
  svg.append(track, arc);
  return svg;
}

function createSvgRoot(size: number, label?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  applyAttributes(svg, {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    focusable: 'false',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  });
  return svg;
}
