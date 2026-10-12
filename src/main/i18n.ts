import i18next from 'i18next';
import { DEFAULT_LANGUAGE, resources } from '../locales';
import { PRODUCT_NAME } from '../shared/product';

const i18n = i18next.createInstance();

void i18n.init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  resources,
  initAsync: false,
  interpolation: { escapeValue: false, defaultVariables: { appName: PRODUCT_NAME } },
  returnNull: false,
});

export const t = i18n.t.bind(i18n);
