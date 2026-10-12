# Lokale Entwicklungsumgebung: Node.js aus .tools/, alle Caches im Projekt.
# Nutzung: source scripts/dev-env.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
export PATH="$ROOT/.tools/node/bin:$ROOT/node_modules/.bin:$PATH"
export npm_config_cache="$ROOT/.tools/cache/npm"
export electron_config_cache="$ROOT/.tools/cache/electron"
export ELECTRON_BUILDER_CACHE="$ROOT/.tools/cache/electron-builder"
export PLAYWRIGHT_BROWSERS_PATH="$ROOT/.tools/cache/playwright"
# Node-fetch soll gesetzte Proxy-Variablen beachten (wirkt nur, wenn ein Proxy gesetzt ist)
export NODE_USE_ENV_PROXY=1
# Heruntergeladene Hilfsprogramme in .tools/ sind CommonJS. Ohne diese Datei würde Node sie wegen
# "type": "module" im Projekt als ES-Module lesen (betrifft z. B. das Symbol-Werkzeug von electron-builder).
[ -f "$ROOT/.tools/package.json" ] || printf '{ "type": "commonjs" }\n' > "$ROOT/.tools/package.json"
