import { readFile, readdir } from "node:fs/promises"

const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8")
const worker = await readFile(new URL("../dist/sw.js", import.meta.url), "utf8")
const assets = await readdir(new URL("../dist/assets/", import.meta.url))

const requiredAssets = assets.filter((name) => name.endsWith(".js") || name.endsWith(".css"))
if (requiredAssets.length < 2) throw new Error("Le build ne contient pas le shell JS/CSS attendu.")
for (const asset of requiredAssets) {
  if (!index.includes(`/assets/${asset}`)) {
    throw new Error(`index.html ne référence pas ${asset}.`)
  }
  if (!worker.includes(`/assets/${asset}`)) {
    throw new Error(`Le service worker ne précharge pas ${asset}.`)
  }
}
for (const file of ["/manifest.webmanifest", "/icons/logo.svg", "/icons/icon-192.png", "/icons/icon-512.png"]) {
  if (!index.includes(file) && !file.startsWith("/icons/icon-")) {
    throw new Error(`index.html ne référence pas ${file}.`)
  }
  if (!worker.includes(`"${file}"`)) {
    throw new Error(`Le service worker ne précharge pas ${file} : l'icône manquerait hors ligne.`)
  }
}
const manifest = JSON.parse(await readFile(new URL("../dist/manifest.webmanifest", import.meta.url), "utf8"))
for (const size of ["192x192", "512x512"]) {
  if (!manifest.icons.some((icon) => icon.sizes === size && icon.type === "image/png")) {
    throw new Error(`Le manifest n'a pas d'icône PNG ${size} : l'app ne serait pas installable.`)
  }
}
if (!manifest.icons.some((icon) => icon.purpose === "maskable")) {
  throw new Error("Le manifest n'a pas d'icône maskable pour Android.")
}

if (!worker.includes('url.pathname.startsWith("/api/")')) {
  throw new Error("Le service worker doit exclure explicitement les API métier.")
}
if (!worker.includes('caches.match("/index.html")')) {
  throw new Error("Le service worker ne possède pas de fallback de navigation offline.")
}

console.log(`Offline shell vérifié : ${requiredAssets.length} assets préchargés.`)
