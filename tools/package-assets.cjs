// Empacota os ativos aprovados. Só redimensiona o PNG; não redesenha a marca.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
async function main() {
  for (const folder of ['icons/ui', 'fonts', 'licenses']) fs.mkdirSync(path.join(root, folder), {recursive:true});
  for (const size of [16,32,48,128]) {
    await sharp(path.join(root,'icons/fullradar-master.png')).resize(size,size,{fit:'contain'}).png().toFile(path.join(root,`icons/icon${size}.png`));
  }
  for (const name of ['settings','calendar','bell','adjustments-horizontal','chevron-left','chevron-right','chevron-down','player-play','radar']) {
    fs.copyFileSync(path.join(root,`node_modules/@tabler/icons/icons/outline/${name}.svg`),path.join(root,`icons/ui/${name}.svg`));
  }
  fs.copyFileSync(path.join(root,'node_modules/@tabler/icons/icons/filled/player-stop.svg'),path.join(root,'icons/ui/player-stop-filled.svg'));
  for (const weight of [400,500,600,700,800]) {
    const name=`inter-latin-${weight}-normal.woff2`;
    fs.copyFileSync(path.join(root,'node_modules/@fontsource/inter/files',name),path.join(root,'fonts',name));
  }
  fs.copyFileSync(path.join(root,'node_modules/@tabler/icons/LICENSE'),path.join(root,'licenses/Tabler-MIT.txt'));
  fs.copyFileSync(path.join(root,'node_modules/@fontsource/inter/LICENSE'),path.join(root,'licenses/Inter-OFL.txt'));
  console.log('Marca 16/32/48/128, 10 ícones e 5 fontes empacotados localmente.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
