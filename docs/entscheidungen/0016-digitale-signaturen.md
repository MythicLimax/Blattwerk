# 0016: Digitale Signaturen mit Zertifikat (PAdES)

- Status: angenommen (2026-10-15, Phase 7)

## Anforderung

Digitale Signaturen mit Zertifikat (PAdES) erstellen und prüfen.

## Entscheidung

### Unterschreiben (`src/workers/pdfium/signing.ts`)

- **Zertifikat und Schlüssel** kommen aus einer PKCS#12-Datei (.p12/.pfx). Gelesen wird sie mit `@libpdf/core` (`P12Signer`, MIT, von Documenso). Es versteht auch ältere Verschlüsselungen (3DES, RC2), wie sie der macOS-Schlüsselbund und viele Zertifizierungsstellen erzeugen; pkijs allein kann nur das neuere PBES2. `P12Signer` berechnet auch die eigentliche Signatur mit dem privaten Schlüssel.
- **Das PDF schreibt die App selbst**, weil `@libpdf/core` Signaturen immer unsichtbar macht: Signaturfeld (sichtbar mit Rahmen, „Digital unterschrieben von“, Name aus dem Zertifikat, Datum, Grund; oder unsichtbar) mit Signaturwörterbuch und Platzhaltern, inkrementell mit pdf-lib angehängt. Danach trägt die App `/ByteRange` ein (alles außer dem Platzhalter) und setzt die Signatur ein. Frühere Stände und Signaturen bleiben unverändert.
- **Signatur (CMS)** mit pkijs: SignedData, detached, SHA-256, signierte Attribute contentType, messageDigest und signingCertificateV2, ohne signingTime (die Zeit steht in `/M`), SubFilter `ETSI.CAdES.detached`. Das entspricht **PAdES B-B**.
- **Kein Zeitstempel (B-T) und keine Langzeitprüfdaten (B-LT/B-LTA):** Beides bräuchte Netzzugriff auf einen Zeitstempeldienst bzw. OCSP/CRL; die App ist bewusst ohne Netz. Ein späterer Schritt könnte einen frei wählbaren Zeitstempeldienst nach Rückfrage erlauben.
- **Nach dem Unterschreiben speichert die App sofort** („Sichern unter“): Unterschreiben ist ein neuer Dokumentstand; ungespeicherte Änderungen danach würden als „nach dem Unterschreiben geändert“ erscheinen.
- **Verschlüsselte Dokumente** erst nach dem Entfernen des Kennwortschutzes (pdf-lib schreibt neue Objekte unverschlüsselt).

### Eigene digitale ID (`identity.ts`)

RSA 2048, selbst ausgestelltes Zertifikat (5 Jahre, keyUsage digitalSignature und nonRepudiation), PKCS#12 mit PBES2 (AES-256, PBKDF2-SHA-256, 100 000 Runden) und MAC SHA-256, erzeugt mit pkijs und WebCrypto. Gespeichert über den Sichern-Dialog; die App merkt sich nur den Pfad der zuletzt verwendeten ID, nie das Kennwort und nie den Schlüssel.

### Prüfen (`signatures.ts`)

Beim Öffnen eines Dokuments mit Signaturfeldern prüft der Worker jede Signatur:

- Passt sie mathematisch zu den Bytes in `/ByteRange` (pkijs, WebCrypto: RSA, RSA-PSS, ECDSA)?
- Deckt sie das ganze Dokument ab oder wurde danach etwas angehängt?
- Wer hat unterschrieben (Name, Organisation, Aussteller)? War das Zertifikat zum Zeitpunkt gültig? Ist es selbst ausgestellt?

Die Leiste über dem Dokument zeigt das Gesamturteil („gültig“, „danach geändert“, „ungültig“), „Details“ listet alle Signaturen. **Eine Vertrauensliste (Stammzertifikate) gibt es nicht**: Die Identität gilt deshalb als „nicht bestätigt“, auch bei Zertifikaten echter Zertifizierungsstellen. Sperrlisten werden nicht abgefragt (kein Netz).

### Lizenzen

`@libpdf/core` bringt `lru-cache` (BlueOak-1.0.0) und `pako` (MIT und Zlib) mit. Beide Lizenzen sind freizügig wie MIT (BlueOak zusätzlich mit Patentzusage) und von der OSI anerkannt; die Lizenzprüfung erlaubt sie jetzt ausdrücklich.

## Prüfung

- `test/integration/signing.test.ts`: sichtbar und unsichtbar unterschreiben (Test-ID im alten Format, RC2/3DES), Prüfung gültig, Änderung danach, verfälschtes Byte, zwei Signaturen nacheinander, falsches Kennwort, eigene ID erstellen und damit unterschreiben, Lesbarkeit der ID mit OpenSSL, Darstellung des Feldes (PDFium).
- `test/e2e/pro.spec.ts`: ganzer Weg in der App mit Feld aufziehen, Speichern, Leiste und Details, eigene ID, zweite Unterschrift, Prüfung mit Apple PDFKit.
- Acrobat Reader: manuelle Prüfung im Phasenbericht.
