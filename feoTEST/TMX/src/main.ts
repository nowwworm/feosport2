import 'i18n/i18n';
import { updateReady } from 'services/notifications/statusMessages';
import { rootBlock } from 'components/framework/rootBlock';
import { startDomPatcher } from 'services/i18n/domPatcher';
import * as serviceWorker from './serviceWorker';
import { setupTMX } from './initialState';

if (globalThis.attachEvent) {
  globalThis.attachEvent('onload', setupTMX);
} else if (globalThis.onload) {
  const curronload = globalThis.onload;
  const newonload = (evt) => {
    // @ts-expect-error globalThis
    curronload(evt);
    setupTMX();
  };
  globalThis.onload = newonload;
} else {
  globalThis.onload = setupTMX;
}

function onUpdate() {
  updateReady();
}

rootBlock();
startDomPatcher();

// NOTE: serviceWorker.unregister() is used for development; serviceWorker.register() is used for production
// @ts-expect-error globalThis
serviceWorker.unregister({ onUpdate });
