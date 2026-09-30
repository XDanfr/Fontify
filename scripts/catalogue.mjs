import {writeFile} from 'node:fs/promises';
// Public Google Fonts metadata: no API key and no remote executable code.
const response = await fetch('https://fonts.google.com/metadata/fonts');
if(!response.ok) throw new Error(`Catalogue request failed: ${response.status}`);
const metadata=JSON.parse((await response.text()).replace(/^\)\]\}'\s*/,''));
const families=metadata.familyMetadataList.map(f=>({family:f.family,category:f.category,weights:Object.keys(f.fonts).filter(k=>!k.includes('i')).map(Number).filter(Number.isFinite),styles:Object.keys(f.fonts).some(k=>k.includes('i'))?['normal','italic']:['normal']})).sort((a,b)=>a.family.localeCompare(b.family));
if(families.length<1000) throw new Error('Unexpectedly small catalogue; refusing to replace snapshot.');
await writeFile('data/catalogue.json',JSON.stringify({updated:new Date().toISOString().slice(0,10),source:'https://fonts.google.com/metadata/fonts',families},null,2)+'\n');
console.log(`Saved ${families.length} Google Fonts families.`);
