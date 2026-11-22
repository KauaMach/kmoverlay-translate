import '@/assets/styles/tokens.css';
import '@/assets/styles/base.css';
import '@/assets/styles/controls.css';
import './popup.css';
import { startPopup } from './controller';

const ROOT_ID = 'app';

const root = document.getElementById(ROOT_ID);
if (root === null) {
  throw new Error(`The popup page has no #${ROOT_ID} element.`);
}
// startPopup reports its own failures on screen; this only catches programming errors.
startPopup(root).catch((error: unknown) => {
  console.error('KMOverlay popup: unexpected failure.', error);
});
