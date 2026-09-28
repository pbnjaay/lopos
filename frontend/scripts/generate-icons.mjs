// Génère toutes les icônes de l'app à partir de public/icons/logo.svg — et
// celles de l'admin Django (backend/static/brand/), pour que les deux
// partent de la même source.
//
//   npm run icons
//
// Le logo est une tuile arrondie de la couleur de marque. Les variantes
// « pleine surface » (Apple, maskable) le posent sur un carré de la même
// couleur : les coins arrondis disparaissent d'eux-mêmes, et le système
// applique son propre masque.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"

import { Resvg } from "@resvg/resvg-js"

const BRAND = "#176b4d"
const iconsDir = new URL("../public/icons/", import.meta.url)
const source = await readFile(new URL("logo.svg", iconsDir), "utf8")
const inner = source
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")

/** `scale` < 1 recentre le logo dans la zone sûre d'une icône maskable. */
function fullBleed(scale) {
  const offset = (64 - 64 * scale) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${BRAND}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g>
</svg>`
}

function renderPng(svg, size) {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()
}

const outputs = [
  ["favicon-32.png", source, 32],
  ["icon-192.png", source, 192],
  ["icon-512.png", source, 512],
  // Zone sûre maskable : un cercle de 80 % du côté. Le logo a déjà ~20 % de
  // marge interne, 0,82 le garde entier même sous un masque circulaire.
  ["icon-maskable-512.png", fullBleed(0.82), 512],
  ["apple-touch-icon.png", fullBleed(1), 180],
]

for (const [name, svg, size] of outputs) {
  await writeFile(new URL(name, iconsDir), renderPng(svg, size))
  console.log(`public/icons/${name} (${size} px)`)
}

// Admin Unfold : icône de la barre latérale et favicons.
const adminDir = new URL("../../backend/static/brand/", import.meta.url)
await mkdir(adminDir, { recursive: true })
await copyFile(new URL("logo.svg", iconsDir), new URL("logo.svg", adminDir))
for (const name of ["favicon-32.png", "apple-touch-icon.png"]) {
  await copyFile(new URL(name, iconsDir), new URL(name, adminDir))
}
console.log("backend/static/brand/ (logo.svg, favicon-32.png, apple-touch-icon.png)")
