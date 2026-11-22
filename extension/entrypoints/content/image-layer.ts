import tokensCss from '@/assets/styles/tokens.css?inline';
import { createImageOverlay, type ImageOverlay, type ImageOverlayCallbacks } from '@/components/image-overlay';
import layerCss from './image-layer.css?inline';

/** Above page content, below the browser's own UI (the maximum z-index is 2147483647). */
const LAYER_Z_INDEX = 2147483000;

/**
 * Inline styles resist most page CSS. The layer never takes clicks, so links
 * and page turns on the original image keep working.
 */
const HOST_STYLE = [
  'position: fixed',
  'top: 0',
  'left: 0',
  'width: 0',
  'height: 0',
  'margin: 0',
  'padding: 0',
  'border: 0',
  'pointer-events: none',
  `z-index: ${LAYER_Z_INDEX}`,
  'display: none',
].join('; ');

/** What the extension draws over one image: the translated picture and the status overlay. */
export interface ImageLayer {
  host: HTMLDivElement;
  overlay: ImageOverlay;
  /** Shows the translated picture over the original, or the original when `null`. */
  showImage(dataUrl: string | null): void;
  /** Moves the layer over the image (viewport coordinates), or hides it with `null`. */
  place(rect: DOMRect | null): void;
  destroy(): void;
}

/** Creates the layer; the caller appends `host` to the page and keeps it placed over the image. */
export function createImageLayer(callbacks: ImageOverlayCallbacks): ImageLayer {
  const host = document.createElement('div');
  host.style.cssText = HOST_STYLE;
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `${tokensCss}\n${layerCss}`;
  const translated = document.createElement('img');
  translated.className = 'translated';
  translated.alt = '';
  translated.hidden = true;
  const overlay = createImageOverlay(callbacks);
  overlay.host.style.position = 'absolute';
  overlay.host.style.inset = '0';
  root.append(style, translated, overlay.host);

  return {
    host,
    overlay,
    showImage(dataUrl) {
      if (dataUrl === null) {
        translated.hidden = true;
        translated.removeAttribute('src');
      } else {
        translated.src = dataUrl;
        translated.hidden = false;
      }
    },
    place(rect) {
      if (rect === null) {
        host.style.display = 'none';
        return;
      }
      host.style.display = 'block';
      host.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      host.style.width = `${rect.width}px`;
      host.style.height = `${rect.height}px`;
    },
    destroy() {
      overlay.destroy();
      host.remove();
    },
  };
}
