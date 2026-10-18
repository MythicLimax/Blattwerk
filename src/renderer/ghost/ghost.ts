// Vorschau am Zeiger beim Herausziehen eines Tabs (ADR 0026). Daten aus dem Fragment der Adresse (src/main/tab-ghost.ts):
// Titel, verkleinertes Bild des Fensters, Größe der Vorschau, dunkle Darstellung.
import './ghost.css';

interface GhostData {
  title: string;
  image: string;
  preview: { width: number; height: number };
  dark: boolean;
}

function read(): GhostData | null {
  try {
    const data = JSON.parse(decodeURIComponent(location.hash.slice(1))) as Partial<GhostData>;
    if (typeof data.title !== 'string' || typeof data.image !== 'string' || typeof data.preview !== 'object' || data.preview === null) return null;
    return { title: data.title, image: data.image, preview: data.preview, dark: data.dark === true };
  } catch {
    return null;
  }
}

const data = read();
if (data) {
  document.documentElement.dataset.theme = data.dark ? 'dark' : 'light';
  const name = document.querySelector<HTMLElement>('.name');
  if (name) name.textContent = data.title;
  const preview = document.querySelector<HTMLImageElement>('.preview');
  if (preview) {
    preview.style.width = `${data.preview.width}px`;
    preview.style.height = `${data.preview.height}px`;
    // Nur eingebettete Bilder (data:); ohne Bild bleibt die Fläche leer
    if (data.image.startsWith('data:image/')) preview.src = data.image;
  }
  // Erst nach dem Laden einblenden, damit die Vorschau nicht halb gezeichnet erscheint
  requestAnimationFrame(() => document.body.classList.add('shown'));
}
