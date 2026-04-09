const fs = require('fs');

async function test() {
  const appJs = fs.readFileSync('./App.js', 'utf8');
  
  const start = appJs.indexOf('const INSTAGRAM_LINK_REGEX');
  const end = appJs.indexOf('export default function App');
  let pureLogic = appJs.substring(start, end);
  
  pureLogic += \`
  resolveInstagramMediaInfos('https://www.instagram.com/reel/DW1_l5rk7TR/?igsh=NzVqeTdnOWNqc2Js')
    .then(res => console.log('Result:', res))
    .catch(err => console.error('Error:', err));
  \`;

  fs.writeFileSync('temp-eval.js', pureLogic);
}
test();