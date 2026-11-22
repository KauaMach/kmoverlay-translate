import '@/assets/styles/tokens.css';
import '@/assets/styles/base.css';
import '@/assets/styles/controls.css';
import './options.css';
import { startOptionsPage } from './options-page';

const ROOT_ID = 'app';

const root = document.getElementById(ROOT_ID);
if (root === null) {
  throw new Error(`The options page has no #${ROOT_ID} element.`);
}
// startOptionsPage reports its own failures on screen; this only catches programming errors.
startOptionsPage(root).catch((error: unknown) => {
  console.error('KMOverlay options: unexpected failure.', error);
});
