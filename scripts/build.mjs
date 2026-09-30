import { build } from 'esbuild';
import { mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
const {version} = JSON.parse(await readFile('package.json'));
for (const browser of ['chrome', 'firefox']) {
  const outdir = `dist/${browser}`;
  await rm(outdir, {recursive:true, force:true});
  await mkdir(outdir, {recursive:true});
  await cp('public', outdir, {recursive:true});
  await cp('data/catalogue.json', `${outdir}/catalogue.json`);
  await cp('LICENSE', `${outdir}/LICENSE`);
  await cp('THIRD_PARTY_NOTICES.md', `${outdir}/THIRD_PARTY_NOTICES.md`);
  await build({entryPoints:['src/background.js','src/content.js','src/ui.js'], bundle:true, outdir, format:'iife', target:['chrome120','firefox140'], minify:true, legalComments:'eof'});
  const manifest = {
    manifest_version:3, name:'Fontify', version,
    description:'Your web, your type. Replace fonts, preserve code, and fine-tune every reading experience.',
    permissions:['storage','contextMenus','activeTab'], host_permissions:['<all_urls>'],
    action:{default_popup:'popup.html', default_title:'Fontify'},
    options_ui:{page:'options.html',open_in_tab:true},
    icons:{16:'icons/16.png',32:'icons/32.png',48:'icons/48.png',128:'icons/128.png'},
    content_scripts:[{matches:['<all_urls>'],js:['content.js'],run_at:'document_idle',all_frames:true,match_about_blank:true}],
    content_security_policy:{extension_pages:"script-src 'self'; object-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com"},
    background:browser==='chrome'?{service_worker:'background.js'}:{scripts:['background.js']}
  };
  if(browser==='chrome') manifest.minimum_chrome_version='120';
  else manifest.browser_specific_settings={gecko:{id:'fontify@xdan.me',strict_min_version:'140.0',data_collection_permissions:{required:['none']}}};
  await writeFile(`${outdir}/manifest.json`,JSON.stringify(manifest,null,2));
}
console.log('Built Chrome and Firefox extensions.');
