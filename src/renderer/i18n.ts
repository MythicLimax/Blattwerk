import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, resources } from '../locales';
import { PRODUCT_NAME } from '../shared/product';

void i18next.use(initReactI18next).init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  resources,
  initAsync: false,
  interpolation: { escapeValue: false, defaultVariables: { appName: PRODUCT_NAME } },
  returnNull: false,
});

export const i18n = i18next;
export const t = i18next.t.bind(i18next);
