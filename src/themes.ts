export interface ThemeDefinition {
  version: 1; id: string; name: string; environment: 'planet' | 'space';
  background: string; fogColor: string; fogDensity: number; rockTint: string; decorationDensity: number;
  sunColor: string; sunIntensity: number; sunAzimuth: number; sunElevation: number;
  ambientColor: string; groundColor: string; ambientIntensity: number; rimColor: string; rimIntensity: number;
}
export const THEMES: Record<string, ThemeDefinition> = {
  aster: { version: 1, id: 'aster', name: 'Aster · Wüste', environment: 'planet', background: '#333c32', fogColor: '#b5ac8e', fogDensity: .00065, rockTint: '#ffffff', decorationDensity: 1,
    sunColor: '#fff1d2', sunIntensity: 3.5, sunAzimuth: -132, sunElevation: 53, ambientColor: '#dce5d7', groundColor: '#77664d', ambientIntensity: 1.15, rimColor: '#bbd9cc', rimIntensity: .25 },
  belt: { version: 1, id: 'belt', name: 'Gürtel · Tiefenraum', environment: 'space', background: '#050a11', fogColor: '#050a11', fogDensity: 0, rockTint: '#c3c9ce', decorationDensity: 1,
    sunColor: '#dce5ec', sunIntensity: 4.2, sunAzimuth: -128, sunElevation: 39, ambientColor: '#91aecb', groundColor: '#101b31', ambientIntensity: .65, rimColor: '#efbb87', rimIntensity: 2.4 },
};
THEMES['aster-dusk']={...THEMES.aster,id:'aster-dusk',name:'Aster · Abendlicht',background:'#383044',fogColor:'#998384',rockTint:'#ead7c6',sunColor:'#ffd5a1',sunIntensity:3.1,sunAzimuth:-65,sunElevation:24,ambientColor:'#adc0da',ambientIntensity:.9,rimColor:'#f7b080',rimIntensity:.8};
THEMES['belt-ice']={...THEMES.belt,id:'belt-ice',name:'Gürtel · Kaltes Sternenlicht',background:'#070d1d',rockTint:'#b6cbd8',sunColor:'#bde4ff',sunIntensity:3.6,sunAzimuth:-155,ambientColor:'#809dbc',rimColor:'#d5bfea',rimIntensity:2.1,decorationDensity:1.3};
