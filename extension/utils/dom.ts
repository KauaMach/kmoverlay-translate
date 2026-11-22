/** A child accepted by {@link h}: nodes and strings are appended, empty values are skipped. */
export type Child = Node | string | null | undefined | false;

/**
 * Attribute values accepted by {@link h}.
 * - `true` adds an empty attribute (`disabled`), `false`/`null`/`undefined` omit it.
 * - ARIA states need explicit strings (`'true'`/`'false'`): `false` omits the attribute,
 *   which ARIA reads differently from `'false'`. `true` on an `aria-*` key becomes
 *   `'true'`, because an empty ARIA value means "not set".
 * - Functions are only allowed on `on*` keys and become event listeners (`onClick` → `click`).
 *   Any other value on an `on*` key throws, because it would become inline script.
 */
export type AttributeValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ((event: Event) => void);

export type Attributes = Record<string, AttributeValue>;

/**
 * Creates an HTML element without parsing markup, so text that comes from web
 * pages or from the server can never be interpreted as HTML.
 */
export function h<TagName extends keyof HTMLElementTagNameMap>(
  tagName: TagName,
  attributes: Attributes = {},
  children: Child[] = [],
): HTMLElementTagNameMap[TagName] {
  const element = document.createElement(tagName);
  applyAttributes(element, attributes);
  appendChildren(element, children);
  return element;
}

const EVENT_ATTRIBUTE_PREFIX = 'on';
const ARIA_ATTRIBUTE_PREFIX = 'aria-';

/**
 * Applies {@link Attributes} to an existing element (HTML or SVG).
 * @throws {Error} for a function on a non-event key, or a non-function value on an `on*` key.
 */
export function applyAttributes(element: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) {
      continue;
    }
    const isEventName = name.toLowerCase().startsWith(EVENT_ATTRIBUTE_PREFIX);
    if (typeof value === 'function') {
      if (!isEventName) {
        throw new Error(`A function was given for the non-event attribute "${name}".`);
      }
      element.addEventListener(name.slice(EVENT_ATTRIBUTE_PREFIX.length).toLowerCase(), value);
    } else if (isEventName) {
      // A string here would be compiled as an inline handler, running text as code.
      throw new Error(`Only a function can be given for the event attribute "${name}".`);
    } else {
      element.setAttribute(name, attributeText(name, value));
    }
  }
}

function attributeText(name: string, value: string | number | true): string {
  if (value === true) {
    return name.startsWith(ARIA_ATTRIBUTE_PREFIX) ? 'true' : '';
  }
  return String(value);
}

/** Appends children, turning strings into text nodes. */
export function appendChildren(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}
