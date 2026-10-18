// Mitgelieferte Vorlagen (ADR 0028) als HTML; htmlToPdf (src/main/convert/pdf.ts) setzt sie mit Chromium als A4-PDF.
// Texte stehen in den Übersetzungen (templates.content), damit sie wie die Oberfläche gepflegt werden. Platzhalter in
// eckigen Klammern überschreibt man im Modus „Text und Bilder bearbeiten“; der Name des Autors und das Datum sind schon
// eingesetzt. Linien und Raster sind SVG, damit sie im PDF als Vektoren landen.
import type { BuiltinTemplate } from '../../shared/templates';

export interface TemplateContext {
  t: (key: string, options?: Record<string, unknown>) => string;
  // Name für Absender und Unterschrift; leer heißt Platzhalter
  author: string;
  date: Date;
}

const ACCENT = '#2f5d3f';

const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.4; color: #1d1d1b; }
.page { position: relative; width: 210mm; height: 296.5mm; overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }
.abs { position: absolute; }
.small { font-size: 8.5pt; color: #555; }
.tiny { font-size: 7pt; }
.bold { font-weight: bold; }
.accent { color: ${ACCENT}; }
.right { text-align: right; }
.center { text-align: center; }
p + p { margin-top: 4.2mm; }
h2 { font-size: 12pt; color: ${ACCENT}; border-bottom: 0.4mm solid ${ACCENT}; padding-bottom: 1mm; margin: 6mm 0 3mm; }
table { border-collapse: collapse; width: 100%; }
td, th { vertical-align: top; text-align: left; }
.rows td { padding: 1.2mm 0; }
.rows td:first-child { width: 42mm; color: #555; }
.grid th { font-weight: bold; border-bottom: 0.4mm solid ${ACCENT}; padding: 1.5mm 2mm; }
.grid td { border-bottom: 0.2mm solid #c9c9c4; padding: 2mm; }
.num { text-align: right; white-space: nowrap; }
.line { border-top: 0.25mm solid #1d1d1b; padding-top: 1mm; }
`;

function document(pages: string[]): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${pages
    .map((page) => `<div class="page">${page}</div>`)
    .join('')}</body></html>`;
}

// Platzierung in Millimetern
const at = (left: number, top: number, width?: number, extra = ''): string =>
  `style="left:${left}mm;top:${top}mm;${width === undefined ? '' : `width:${width}mm;`}${extra}"`;

const formatDate = (date: Date): string => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);

function common(ctx: TemplateContext) {
  const c = (key: string, options?: Record<string, unknown>) => escape(ctx.t(`templates.content.common.${key}`, options));
  const date = formatDate(ctx.date);
  return { c, date, name: ctx.author ? escape(ctx.author) : c('name') };
}

// Falz- und Lochmarken am linken Rand (DIN 5008)
const FOLD_MARKS = `<svg class="abs" ${at(0, 0, 8, 'height:297mm')} viewBox="0 0 8 297"><path d="M3 105H8M3 210H8M2 148.5H8" stroke="#9a9a94" stroke-width="0.2"/></svg>`;

// Brief nach DIN 5008, Form B: Anschriftfeld 45 mm von oben, Informationsblock rechts, Betreff bei etwa 98 mm
function letter(ctx: TemplateContext): string {
  const { c, date, name } = common(ctx);
  const l = (key: string) => escape(ctx.t(`templates.content.letter.${key}`));
  return document([
    `${FOLD_MARKS}
    <div class="abs right" ${at(110, 15, 80)}>
      <div class="bold" style="font-size:14pt">${name}</div>
      <div>${c('street')}</div><div>${c('city')}</div><div>${c('phone')}</div><div>${c('email')}</div>
    </div>
    <div class="abs tiny" ${at(25, 57, 85)}><u>${name} · ${c('street')} · ${c('city')}</u></div>
    <div class="abs" ${at(25, 63, 85)}>
      <div>${c('company')}</div><div>${c('recipientName')}</div><div>${c('street')}</div><div>${c('city')}</div>
    </div>
    <div class="abs" ${at(125, 63, 65)}><span class="small">${c('date')}:</span> ${date}</div>
    <div class="abs bold" ${at(25, 98.5, 165)}>${l('subject')}</div>
    <div class="abs" ${at(25, 110, 165)}>
      <p>${c('salutation')}</p>
      <p>${l('body')}</p>
      <p>${c('regards')}</p>
      <p style="margin-top:14mm">${name}</p>
    </div>`,
  ]);
}

// Kopf für Bewerbung und Lebenslauf: Name groß, Kontakt in einer Zeile, Linie in der Akzentfarbe
function profileHeader(ctx: TemplateContext, width = 165): string {
  const { c, name } = common(ctx);
  return `<div class="abs" ${at(25, 18, width)}>
      <div class="accent" style="font-size:22pt;font-weight:bold;line-height:1.15">${name}</div>
      <div class="small" style="margin-top:2mm">${c('street')} · ${c('city')} · ${c('phone')} · ${c('email')}</div>
      <div style="border-bottom:0.6mm solid ${ACCENT};margin-top:3mm"></div>
    </div>`;
}

function application(ctx: TemplateContext): string {
  const { c, date, name } = common(ctx);
  const a = (key: string) => escape(ctx.t(`templates.content.application.${key}`));
  return document([
    `${FOLD_MARKS}${profileHeader(ctx)}
    <div class="abs" ${at(25, 50, 85)}>
      <div>${c('company')}</div><div>${c('recipientName')}</div><div>${c('street')}</div><div>${c('city')}</div>
    </div>
    <div class="abs right" ${at(110, 88, 80)}>${c('placeDate', { date })}</div>
    <div class="abs" ${at(25, 98.5, 165)}>
      <div class="bold">${a('subject')}</div>
      <div class="small">${a('reference')}</div>
    </div>
    <div class="abs" ${at(25, 114, 165)}>
      <p>${c('salutation')}</p>
      <p>${a('p1')}</p>
      <p>${a('p2')}</p>
      <p>${a('p3')}</p>
      <p>${c('regards')}</p>
      <p style="margin-top:14mm">${name}</p>
    </div>
    <div class="abs small" ${at(25, 265, 165)}>${a('attachments')}</div>`,
  ]);
}

function cv(ctx: TemplateContext): string {
  const { c, date } = common(ctx);
  const v = (key: string) => escape(ctx.t(`templates.content.cv.${key}`));
  const row = (label: string, value: string) => `<tr><td>${label}</td><td>${value}</td></tr>`;
  const entry = (period: string, title: string, place: string, detail: string) =>
    `<tr><td>${period}</td><td><div class="bold">${title}</div><div>${place}</div><div class="small">${detail}</div></td></tr>`;
  return document([
    `${profileHeader(ctx, 125)}
    <div class="abs center small" ${at(155, 15, 35, `height:45mm;border:0.3mm dashed #9a9a94;padding-top:20mm`)}>${v('photo')}</div>
    <div class="abs" ${at(25, 46, 125)}><div class="accent" style="font-size:13pt">${v('title')}</div></div>
    <div class="abs" ${at(25, 62, 165)}>
      <h2>${v('personal')}</h2>
      <table class="rows">${row(v('birth'), v('birthValue'))}${row(v('nationality'), v('nationalityValue'))}</table>
      <h2>${v('experience')}</h2>
      <table class="rows">${entry(v('periodNow'), v('position'), v('employer'), v('duty'))}${entry(v('period'), v('position'), v('employer'), v('duty'))}</table>
      <h2>${v('education')}</h2>
      <table class="rows">${entry(v('period'), v('degree'), v('school'), v('focus'))}${entry(v('period'), v('degree'), v('school'), v('focus'))}</table>
      <h2>${v('skills')}</h2>
      <table class="rows">${row(v('languages'), v('languagesValue'))}${row(v('it'), v('itValue'))}${row(v('license'), v('licenseValue'))}</table>
      <h2>${v('interests')}</h2>
      <div>${v('interestsValue')}</div>
    </div>
    <div class="abs" ${at(25, 262, 70)}><div>${c('placeDate', { date })}</div><div class="line small" style="margin-top:2mm">${c('signaturePlaceDate')}</div></div>
    <div class="abs" ${at(120, 262, 70)}><div>&nbsp;</div><div class="line small" style="margin-top:2mm">${c('signature')}</div></div>`,
  ]);
}

function invoice(ctx: TemplateContext): string {
  const { c, date, name } = common(ctx);
  const i = (key: string) => escape(ctx.t(`templates.content.invoice.${key}`));
  const item = (n: number) =>
    `<tr><td>${n}</td><td>${i('item')}</td><td class="num">1</td><td class="num">${i('amount')}</td><td class="num">${i('amount')}</td></tr>`;
  return document([
    `${FOLD_MARKS}
    <div class="abs" ${at(25, 15, 100)}>
      <div class="accent bold" style="font-size:16pt">${name}</div>
      <div class="small">${c('street')} · ${c('city')}</div>
    </div>
    <div class="abs tiny" ${at(25, 57, 85)}><u>${name} · ${c('street')} · ${c('city')}</u></div>
    <div class="abs" ${at(25, 63, 85)}>
      <div>${c('company')}</div><div>${c('recipientName')}</div><div>${c('street')}</div><div>${c('city')}</div>
    </div>
    <div class="abs" ${at(125, 55, 65)}>
      <table class="rows small">
        <tr><td style="width:32mm">${i('number')}</td><td class="right">${i('numberValue')}</td></tr>
        <tr><td>${i('invoiceDate')}</td><td class="right">${date}</td></tr>
        <tr><td>${i('serviceDate')}</td><td class="right">${i('serviceDateValue')}</td></tr>
        <tr><td>${i('customer')}</td><td class="right">${i('customerValue')}</td></tr>
      </table>
    </div>
    <div class="abs" ${at(25, 98.5, 165)}>
      <div class="bold" style="font-size:16pt">${i('title')} ${i('numberValue')}</div>
      <p style="margin-top:5mm">${i('intro')}</p>
      <table class="grid" style="margin-top:5mm">
        <tr><th style="width:12mm">${i('pos')}</th><th>${i('description')}</th><th class="num" style="width:18mm">${i('quantity')}</th><th class="num" style="width:28mm">${i('unitPrice')}</th><th class="num" style="width:28mm">${i('total')}</th></tr>
        ${item(1)}${item(2)}${item(3)}
      </table>
      <table style="width:80mm;margin:4mm 0 0 auto">
        <tr><td style="padding:1mm 0">${i('net')}</td><td class="num">${i('amount')}</td></tr>
        <tr><td style="padding:1mm 0">${i('vat')}</td><td class="num">${i('amount')}</td></tr>
        <tr><td class="bold" style="padding:2mm 0;border-top:0.4mm solid ${ACCENT}">${i('gross')}</td><td class="num bold" style="padding:2mm 0;border-top:0.4mm solid ${ACCENT}">${i('amount')}</td></tr>
      </table>
      <p style="margin-top:8mm">${i('terms')}</p>
      <p>${c('regards')}<br>${name}</p>
    </div>
    <div class="abs small" ${at(25, 268, 165, `border-top:0.3mm solid ${ACCENT};padding-top:2mm;display:flex;gap:8mm`)}>
      <div style="flex:1"><div class="bold">${name}</div><div>${c('street')}</div><div>${c('city')}</div></div>
      <div style="flex:1"><div>${c('phone')}</div><div>${c('email')}</div><div>${i('tax')}</div></div>
      <div style="flex:1.3"><div class="bold">${i('bank')}: ${i('bankName')}</div><div>${i('iban')}</div><div>${i('bic')}</div></div>
    </div>`,
  ]);
}

function minutes(ctx: TemplateContext): string {
  const { c, date, name } = common(ctx);
  const m = (key: string, options?: Record<string, unknown>) => escape(ctx.t(`templates.content.minutes.${key}`, options));
  const row = (label: string, value: string) => `<tr><td>${label}</td><td>${value}</td></tr>`;
  const task = `<tr><td>${m('taskValue')}</td><td>${m('ownerValue')}</td><td>${m('dueValue')}</td></tr>`;
  return document([
    `<div class="abs" ${at(25, 20, 165)}>
      <div class="accent bold" style="font-size:22pt">${m('title')}</div>
      <div style="font-size:13pt">${m('occasion')}</div>
      <table class="rows" style="margin-top:5mm">
        ${row(c('date'), date)}${row(m('time'), m('timeValue'))}${row(m('place'), m('placeValue'))}${row(m('writer'), name)}${row(m('present'), m('presentValue'))}${row(m('absent'), m('absentValue'))}
      </table>
      <h2>${m('agenda')}</h2>
      <ol style="padding-left:6mm">${[1, 2, 3].map((n) => `<li>${m('topic', { n })}</li>`).join('')}</ol>
      ${[1, 2, 3].map((n) => `<h2>${m('topic', { n })}</h2><div>${m('notes')}</div>`).join('')}
      <h2>${m('decisions')}</h2>
      <div>${m('decision')}</div>
      <h2>${m('tasks')}</h2>
      <table class="grid"><tr><th>${m('task')}</th><th style="width:45mm">${m('owner')}</th><th style="width:30mm">${m('due')}</th></tr>${task}${task}${task}</table>
    </div>
    <div class="abs" ${at(25, 268, 70)}><div class="line small">${c('signaturePlaceDate')}</div></div>
    <div class="abs" ${at(120, 268, 70)}><div class="line small">${m('writerSignature')}</div></div>`,
  ]);
}

function cover(ctx: TemplateContext): string {
  const { date, name } = common(ctx);
  const v = (key: string) => escape(ctx.t(`templates.content.cover.${key}`));
  const row = (label: string, value: string) => `<tr><td>${label}</td><td>${value}</td></tr>`;
  return document([
    `<div class="abs center small" ${at(25, 25, 160)}>${v('school')}</div>
    <div class="abs center" ${at(25, 95, 160)}>
      <div class="small">${v('kind')}</div>
      <div class="accent bold" style="font-size:28pt;line-height:1.2;margin-top:4mm">${v('title')}</div>
      <div style="font-size:14pt;margin-top:4mm">${v('subtitle')}</div>
      <div style="width:40mm;margin:8mm auto 0;border-bottom:0.6mm solid ${ACCENT}"></div>
    </div>
    <div class="abs" ${at(25, 215, 160)}>
      <table class="rows">${row(v('author'), name)}${row(v('course'), v('courseValue'))}${row(v('subject'), v('subjectValue'))}${row(v('teacher'), v('teacherValue'))}${row(v('due'), date)}</table>
    </div>`,
  ]);
}

function todo(ctx: TemplateContext): string {
  const v = (key: string) => escape(ctx.t(`templates.content.todo.${key}`));
  // Wochentage durch „|“ getrennt
  const days = ctx.t('templates.content.todo.days').split('|');
  // Aufgaben: Kästchen und Schreiblinie je Zeile
  const rows = 24;
  const step = 9.5;
  const top = 45;
  const boxes = Array.from({ length: rows }, (_, n) => {
    const y = top + n * step;
    return `<rect x="25" y="${y - 5}" width="4.2" height="4.2" rx="0.6" fill="none" stroke="#6b6b66" stroke-width="0.25"/><path d="M32 ${y}H185" stroke="#c9c9c4" stroke-width="0.2"/>`;
  }).join('');
  // Wochenplan: sieben gleich hohe Felder, links der Tag
  const dayHeight = 33;
  const planTop = 40;
  const plan = days
    .map((day, n) => {
      const y = planTop + n * dayHeight;
      return `<div class="abs bold accent" ${at(27, y + 2, 30)}>${escape(day)}</div>`;
    })
    .join('');
  const planLines = days
    .map((_, n) => `<path d="M25 ${planTop + n * dayHeight}H185" stroke="${ACCENT}" stroke-width="${n === 0 ? 0.4 : 0.2}"/>`)
    .join('');
  return document([
    `<div class="abs" ${at(25, 20, 160)}>
      <div class="accent bold" style="font-size:20pt">${v('tasks')}</div>
      <div class="small">${v('week')}</div>
    </div>
    <svg class="abs" ${at(0, 0, 210, 'height:297mm')} viewBox="0 0 210 297">${boxes}</svg>`,
    `<div class="abs" ${at(25, 20, 160)}>
      <div class="accent bold" style="font-size:20pt">${v('plan')}</div>
      <div class="small">${v('week')}</div>
    </div>
    <svg class="abs" ${at(0, 0, 210, 'height:297mm')} viewBox="0 0 210 297">${planLines}<path d="M25 ${planTop + 7 * dayHeight}H185" stroke="${ACCENT}" stroke-width="0.4"/></svg>
    ${plan}`,
  ]);
}

// Notizpapier: liniert (8 mm, Randlinie), kariert (5 mm) und gepunktet (5 mm)
function notepaper(): string {
  const page = (content: string) => `<svg class="abs" ${at(0, 0, 210, 'height:297mm')} viewBox="0 0 210 297">${content}</svg>`;
  let lined = '';
  for (let y = 30; y <= 282; y += 8) lined += `M15 ${y}H195`;
  let grid = '';
  for (let x = 10; x <= 200; x += 5) grid += `M${x} 12V287`;
  for (let y = 12; y <= 287; y += 5) grid += `M10 ${y}H200`;
  let dots = '';
  for (let x = 10; x <= 200; x += 5) for (let y = 12; y <= 287; y += 5) dots += `M${x} ${y}h0.01`;
  return document([
    page(`<path d="${lined}" stroke="#b7c4cc" stroke-width="0.25"/><path d="M30 12V287" stroke="#d9a3a3" stroke-width="0.3"/>`),
    page(`<path d="${grid}" stroke="#c4ccd1" stroke-width="0.15"/>`),
    page(`<path d="${dots}" stroke="#8f979c" stroke-width="0.55" stroke-linecap="round"/>`),
  ]);
}

export function templateHtml(name: BuiltinTemplate, ctx: TemplateContext): string {
  switch (name) {
    case 'letter':
      return letter(ctx);
    case 'application':
      return application(ctx);
    case 'cv':
      return cv(ctx);
    case 'invoice':
      return invoice(ctx);
    case 'minutes':
      return minutes(ctx);
    case 'cover':
      return cover(ctx);
    case 'todo':
      return todo(ctx);
    case 'notepaper':
      return notepaper();
  }
}
