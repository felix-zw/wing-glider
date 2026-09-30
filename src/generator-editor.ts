import {SCULPT_SHAPES} from './sculpt';
import type {GeneratorOptions} from './asteroid-generator';
export interface GeneratorSettings extends GeneratorOptions {seed:number;autoSeed:boolean;extras:boolean}
export function generatorPalette(s:GeneratorSettings,busy:boolean){return `<details open><summary>Asteroiden-Generator</summary>
  <button id="generator-new" ${busy?'disabled':''}>＋ Zufallsasteroid platzieren</button>
  <label>Generator-Seed<input aria-label="Generator-Seed" data-generator="seed" type="number" value="${s.seed}" min="0" max="2147483647" step="1"></label>
  <label><span><input data-generator="autoSeed" type="checkbox" ${s.autoSeed?'checked':''}> Neuer Zufall bei jedem Aufruf</span></label>
  <label>Grundform<select data-generator="shape"><option value="random" ${s.shape==='random'?'selected':''}>Zufällige Grundform</option>${Object.entries(SCULPT_SHAPES).map(([id,name])=>`<option value="${id}" ${s.shape===id?'selected':''}>${name}</option>`).join('')}</select></label>
  <label>Ausbrüche<input aria-label="Ausbrüche" data-generator="roughness" type="range" min="0" max="1" step=".05" value="${s.roughness}"></label>
  <label>Erzdichte<input aria-label="Erzdichte" data-generator="density" type="range" min="0" max="1" step=".05" value="${s.density}"></label>
  <label>Generierte Rohstoffe<select data-generator="resource">${[['all','Alle drei Rohstoffe'],['ferrite','Ferrit'],['copper','Kupfererz'],['crystal','Kristalle']].map(([id,name])=>`<option value="${id}" ${s.resource===id?'selected':''}>${name}</option>`).join('')}</select></label>
  <label>Leuchtpalette<select data-generator="profile">${[['random','Zufällig'],['warm','Warm · Glut'],['cold','Kühl · Mineralien']].map(([id,name])=>`<option value="${id}" ${s.profile===id?'selected':''}>${name}</option>`).join('')}</select></label>
  <label><span><input data-generator="extras" type="checkbox" ${s.extras?'checked':''}> Neuer Asteroid mit Erz & Leuchten</span></label>
  <p class="editor-note">Seed wiederverwenden: Zufallsoption ausschalten. Jeder Aufruf ist ein Rückgängig-Schritt.</p></details>`;}
export function generatorSelection(busy:boolean){return `<details open><summary>Auswahl generieren</summary><div class="editor-palette">
  ${[['form','Form neu generieren'],['ore','Erze neu generieren'],['glow','Oberflächenleuchten generieren'],['core','Inneres generieren'],['all','Alles neu generieren']].map(([id,label])=>`<button data-generate="${id}" ${busy?'disabled':''}>${label}</button>`).join('')}
  </div><p class="editor-note">Einstellungen links. Erzgenerierung ersetzt die gewählten Rohstoffe nur auf diesem Fels. Formänderungen können bestehende Erzflächen ungültig machen; diese werden markiert.</p></details>`;}
