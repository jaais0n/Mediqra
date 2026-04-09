const fs = require('fs');

async function testFetch() {
  const url = 'https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables={"shortcode":"DW1_l5rk7TR"}';
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
    'Accept': '*/*'
  };
  
  const resp = await fetch(url, { headers });
  console.log('Status: ', resp.status);
  const text = await resp.text();
  console.log('Graphql Query response length:', text.length);
  
  const url2 = 'https://www.instagram.com/reel/DW1_l5rk7TR/?__a=1&__d=dis';
  const resp2 = await fetch(url2, { headers });
  console.log('Status2: ', resp2.status);
  const text2 = await resp2.text();
  console.log('__a=1 response length:', text2.length);

  fs.writeFileSync('graph.json', text2);
}
testFetch();


function extractAllEscapedJsonValues(text, key) {
  const values = [];
  const tokenStart = `${key}\\\":\\\"`;
  let searchPos = 0;

  while (true) {
    const idx = text.indexOf(tokenStart, searchPos);
    if (idx === -1) break;

    let pos = idx + tokenStart.length;
    let value = '';

    while (pos < text.length - 1) {
      if (text[pos] === '\\' && text[pos + 1] === '"') break;
      value += text[pos];
      pos += 1;
    }

    if (value && value.includes('http')) {
      const unescaped = value
        .replace(/\\\//g, '/')
        .replace(/\\u0026/g, '&')
        .replace(/\\u003C/g, '<')
        .replace(/\\u003E/g, '>')
        .replace(/\\u0027/g, "'")
        .replace(/\\\\/g, '\\');

      if (unescaped && !values.includes(unescaped)) {
        values.push(unescaped);
      }
    }
    searchPos = pos + 2;
  }
  return values;
}
console.log('Length is: ', fs.readFileSync('embed.html', 'utf8').length); 
