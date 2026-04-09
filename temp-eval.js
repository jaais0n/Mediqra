




import {
  Alert,
  AppState,
  Linking,
  NativeModules,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

const INSTAGRAM_LINK_REGEX = /(https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s]+)/i;
const INSTAGRAM_DOWNLOAD_HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Mobile Safari/537.36',
  Origin: 'https://www.instagram.com',
  'X-IG-App-ID': '936619743392459',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Dest': 'video',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Site': 'same-site',
};
const LOCAL_PROXY_PORT = 8787;

function getDevServerHost() {
  const scriptURL = NativeModules?.SourceCode?.scriptURL;
  if (!scriptURL) {
    return null;
  }

  try {
    const parsed = new URL(scriptURL);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

function buildLocalProxyUrl(targetUrl, referer) {
  const host = getDevServerHost();
  if (!host) {
    return null;
  }

  try {
    const proxyUrl = new URL(`http://${host}:${LOCAL_PROXY_PORT}/proxy`);
    proxyUrl.searchParams.set('url', targetUrl);
    if (referer) {
      proxyUrl.searchParams.set('referer', referer);
    }
    return proxyUrl.toString();
  } catch {
    return null;
  }
}

function extractInstagramLink(value) {
  if (!value) {
    return null;
  }

  const match = value.match(INSTAGRAM_LINK_REGEX);
  return match?.[1] ?? null;
}

function extractMetaContent(html, propertyName) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${propertyName}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const match = html.match(pattern);
  return match?.[1] ?? null;
}

function getFileExtensionFromUrl(url, fallbackExtension) {
  try {
    const pathname = new URL(url).pathname;
    const extensionMatch = pathname.match(/\.(mp4|mov|m4v|jpg|jpeg|png|webp)(?:$|\?)/i);
    if (extensionMatch?.[1]) {
      return `.${extensionMatch[1].toLowerCase()}`;
    }
  } catch {
    // Ignore invalid URLs and use the fallback extension.
  }

  return fallbackExtension;
}

function extractEscapedJsonValue(text, key) {
  const token = `${key}\\\":\\\"`;
  const startIndex = text.indexOf(token);
  if (startIndex === -1) {
    return null;
  }

  const valueStart = startIndex + token.length;
  let cursor = valueStart;
  let escaped = false;

  while (cursor < text.length) {
    const character = text[cursor];
    if (character === '"' && !escaped) {
      break;
    }

    escaped = character === '\\' && !escaped;
    if (character !== '\\') {
      escaped = false;
    }

    cursor += 1;
  }

  const rawValue = text.slice(valueStart, cursor);
  try {
    return JSON.parse(`"${rawValue}"`);
  } catch {
    return rawValue
      .replace(/\\\//g, '/')
      .replace(/\\u0026/g, '&')
      .replace(/\\u003C/g, '<')
      .replace(/\\u003E/g, '>')
      .replace(/\\u0027/g, "'")
      .replace(/\\\\/g, '\\');
  }
}

function extractAllEscapedJsonValues(text, key) {
  const values = [];
  
  // Simple substring search for key\":\"pattern
  const tokenStart = `${key}\\\":\\\"`;
  let searchPos = 0;

  while (true) {
    const idx = text.indexOf(tokenStart, searchPos);
    if (idx === -1) break;

    // Start after the pattern
    let pos = idx + tokenStart.length;
    let value = '';

    // Collect characters until we see \", the closing pattern
    while (pos < text.length - 1) {
      if (text[pos] === '\\' && text[pos + 1] === '"') {
        // Found closing \"
        break;
      }
      value += text[pos];
      pos += 1;
    }

    // Unescape common Instagram escapes
    if (value && value.includes('http')) {
      const unescaped = value
        .replace(/\\\//g, '/')          // \/ -> /
        .replace(/\\u0026/g, '&')       // \u0026 -> &
        .replace(/\\u003C/g, '<')       // \u003C -> <
        .replace(/\\u003E/g, '>')       // \u003E -> >
        .replace(/\\u0027/g, "'")       // \u0027 -> '
        .replace(/\\\\/g, '\\');        // \\ -> \

      if (unescaped && !values.includes(unescaped)) {
        values.push(unescaped);
      }
    }

    searchPos = pos + 2;  // Move past the \"
  }

  return values;
}

function extractShortcode(instagramLink) {
  const match = instagramLink.match(/instagram\.com\/(?:reel|p|tv)\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function normalizeInstagramPostUrl(instagramLink) {
  try {
    const parsed = new URL(instagramLink);
    parsed.search = '';
    parsed.hash = '';
    // Keep only the canonical post path (reel/p/tv + shortcode).
    const shortcode = extractShortcode(parsed.href);
    if (shortcode) {
      const typeMatch = parsed.pathname.match(/\/(reel|p|tv)\//i);
      const postType = typeMatch?.[1] ?? 'p';
      return `${parsed.origin}/${postType}/${shortcode}/`;
    }

    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return instagramLink;
  }
}

function normalizeMediaItems(urls, kind, fallbackExtension) {
  const unique = new Set();
  const items = [];

  for (const url of urls) {
    if (!url || unique.has(url) || url.includes('static.cdninstagram.com/rsrc.php')) {
      continue;
    }

    unique.add(url);
    items.push({
      url,
      kind,
      extension: getFileExtensionFromUrl(url, fallbackExtension),
    });
  }

  return items;
}

function decodeEscapedInstagramUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value
      .replace(/\\\//g, '/')
      .replace(/\\u0026/g, '&')
      .replace(/\\u003C/g, '<')
      .replace(/\\u003E/g, '>')
      .replace(/\\u0027/g, "'")
      .replace(/\\\\/g, '\\');
  }
}
function decodeEmbedUrlValue(rawValue) {
  if (!rawValue) {
    return null;
  }

  const cleaned = rawValue
    .replace(/\\\\\//g, '/')
    .replace(/\\\//g, '/');
  const decoded = decodeEscapedInstagramUrl(cleaned);
  return decoded || cleaned;
}

function extractMp4UrlsFromEmbed(embedHtml) {
  const urls = new Set();
  const patterns = [
    /https:\\\/\\\/[^"\s]+?\.mp4[^"\s]*/g,
    /https:\/\/[^"\s]+?\.mp4[^"\s]*/g,
    /https?:\/\/[^"\s]+?\.mp4[^"\s]*/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(embedHtml)) !== null) {
      const decoded = decodeEmbedUrlValue(match[0]);
      if (decoded) {
        urls.add(decoded);
      }
    }
  }

  return Array.from(urls);
}

function extractVideoUrlsFromText(text) {
  const urls = new Set();
  const patterns = [
    new RegExp(String.raw`video_url\\":\\"(https?:\/\/[^"\s]+)`, 'g'),
    new RegExp(String.raw`"video_url":"(https?:\/\/[^"\s]+)`, 'g'),
    new RegExp(String.raw`video_url":"(https?:\/\/[^"\s]+)`, 'g'),
    new RegExp(String.raw`video_url\\":\"(https?:\/\/[^"\s]+)`, 'g'),
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const decoded = decodeEmbedUrlValue(match[1]);
      if (decoded) {
        urls.add(decoded);
      }
    }
  }

  return Array.from(urls);
}

function extractEmbedUrlsByRegex(embedHtml, key) {
  const urls = [];
  
  // Look for key\":\" followed by any URL
  // Match loosely to handle different quote styles
  const searchStr = `${key}\\\":\\\"`;
  let pos = 0;

  while (pos >= 0) {
    pos = embedHtml.indexOf(searchStr, pos);
    if (pos === -1) break;

    // Skip past the key\":\" pattern
    let urlStart = pos + searchStr.length;
    let urlEnd = urlStart;

    // Find the end of the URL (look for closing \" or other delimiters)
    while (urlEnd < embedHtml.length) {
      if ((embedHtml[urlEnd] === '\\' && embedHtml[urlEnd + 1] === '"') ||
          (embedHtml[urlEnd] === '"' && (urlEnd === 0 || embedHtml[urlEnd - 1] !== '\\'))) {
        break;
      }
      urlEnd += 1;
    }

    const rawUrl = embedHtml.substring(urlStart, urlEnd);
    
    if (rawUrl && rawUrl.includes('http')) {
      const decoded = decodeEmbedUrlValue(rawUrl);
      if (decoded && !urls.includes(decoded)) {
        urls.push(decoded);
      }
    }

    pos += 1;
  }

  return urls;
}

function extractGraphVideoUrls(payload) {
  const urls = new Set();

  const pushUrl = (value) => {
    if (typeof value !== 'string' || !value.includes('http')) {
      return;
    }
    const decoded = decodeEmbedUrlValue(value);
    if (decoded) {
      urls.add(decoded);
    }
  };

  const collectFromMedia = (media) => {
    if (!media || typeof media !== 'object') {
      return;
    }

    if (typeof media.video_url === 'string') {
      pushUrl(media.video_url);
    }

    if (Array.isArray(media.video_versions)) {
      for (const version of media.video_versions) {
        pushUrl(version?.url);
      }
    }

    if (Array.isArray(media.carousel_media)) {
      for (const item of media.carousel_media) {
        collectFromMedia(item);
      }
    }
  };

  if (payload?.graphql?.shortcode_media) {
    collectFromMedia(payload.graphql.shortcode_media);
  }

  if (Array.isArray(payload?.items)) {
    for (const item of payload.items) {
      collectFromMedia(item);
    }
  }

  return Array.from(urls);
}

async function resolveInstagramMediaInfos(instagramLink) {
  const normalizedLink = normalizeInstagramPostUrl(instagramLink);
  const isReel = /\/reel\//i.test(normalizedLink);
  const embedUrl = `${normalizedLink.replace(/\/$/, '')}/embed/`;
  const embedResponse = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (embedResponse.ok) {
    const embedHtml = await embedResponse.text();
    const shortcode = extractShortcode(normalizedLink);
    const payloadForVideo = embedHtml;
    let scopedPayload = embedHtml;

    if (shortcode) {
      const anchor = `shortcode\\\":\\\"${shortcode}\\\"`;
      const anchorIndex = embedHtml.indexOf(anchor);
      if (anchorIndex !== -1) {
        const start = Math.max(0, anchorIndex - 120000);
        const end = Math.min(embedHtml.length, anchorIndex + 240000);
        scopedPayload = embedHtml.slice(start, end);
      }
    }

    const mp4Items = normalizeMediaItems(
      extractMp4UrlsFromEmbed(payloadForVideo),
      'video',
      '.mp4'
    );
    console.log('Video items from mp4 scan:', mp4Items.length);
    if (mp4Items.length > 0) {
      return mp4Items;
    }

    const directVideoItems = normalizeMediaItems(
      extractVideoUrlsFromText(payloadForVideo),
      'video',
      '.mp4'
    );
    console.log('Video items from text scan:', directVideoItems.length);
    if (directVideoItems.length > 0) {
      return directVideoItems;
    }

    const videoItems = normalizeMediaItems(
      extractAllEscapedJsonValues(payloadForVideo, 'video_url'),
      'video',
      '.mp4'
    );
    console.log('Video items from token scanner:', videoItems.length);
    if (videoItems.length > 0) {
      return videoItems;
    }

    const regexVideoItems = normalizeMediaItems(
      extractEmbedUrlsByRegex(payloadForVideo, 'video_url'),
      'video',
      '.mp4'
    );
    console.log('Video items from regex:', regexVideoItems.length);
    if (regexVideoItems.length > 0) {
      return regexVideoItems;
    }

    if (!isReel) {
      const imageItems = normalizeMediaItems(
        [
          ...extractAllEscapedJsonValues(scopedPayload, 'display_url'),
          ...extractAllEscapedJsonValues(scopedPayload, 'thumbnail_src'),
        ],
        'image',
        '.jpg'
      );
      console.log('Image items from token scanner:', imageItems.length);
      if (imageItems.length > 0) {
        return imageItems;
      }

      const regexImageItems = normalizeMediaItems(
        [
          ...extractEmbedUrlsByRegex(scopedPayload, 'display_url'),
          ...extractEmbedUrlsByRegex(scopedPayload, 'thumbnail_src'),
        ],
        'image',
        '.jpg'
      );
      console.log('Image items from regex:', regexImageItems.length);
      if (regexImageItems.length > 0) {
        return regexImageItems;
      }
    }
  }

  const graphEndpoint = `${normalizedLink}?__a=1&__d=dis`;
  try {
    const response = await fetch(graphEndpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
        Accept: 'application/json,text/plain,*/*',
      },
    });

    if (response.ok) {
      let text = await response.text();
      if (text.startsWith('for (;;);')) {
        text = text.replace(/^for \(;;\);/, '');
      }

      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }

      const graphVideos = payload ? extractGraphVideoUrls(payload) : [];
      const regexVideos = graphVideos.length === 0 ? extractVideoUrlsFromText(text) : [];
      const finalVideos = graphVideos.length > 0 ? graphVideos : regexVideos;
      if (finalVideos.length > 0) {
        return normalizeMediaItems(finalVideos, 'video', '.mp4');
      }
    }
  } catch {
    // Fall through to oEmbed and HTML scraping below.
  }

  if (!isReel) {
    const mobileOembedEndpoint = `https://i.instagram.com/api/v1/oembed/?url=${encodeURIComponent(normalizedLink)}`;
    try {
      const response = await fetch(mobileOembedEndpoint, {
        headers: {
          'User-Agent': 'Instagram 219.0.0.12.117 Android',
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.thumbnail_url) {
          return [{
            url: data.thumbnail_url,
            extension: getFileExtensionFromUrl(data.thumbnail_url, '.jpg'),
            kind: 'image',
          }];
        }
      }
    } catch {
      // Fall through to the web oEmbed and HTML scraping fallbacks below.
    }

    const webOembedEndpoint = `https://www.instagram.com/oembed/?url=${encodeURIComponent(normalizedLink)}`;
    try {
      const response = await fetch(webOembedEndpoint, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.thumbnail_url) {
          return [{
            url: data.thumbnail_url,
            extension: getFileExtensionFromUrl(data.thumbnail_url, '.jpg'),
            kind: 'image',
          }];
        }
      }
    } catch {
      // Fall through to HTML scraping below.
    }
  }

  const pageResponse = await fetch(normalizedLink, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!pageResponse.ok) {
    throw new Error('Could not fetch Instagram page metadata.');
  }

  const html = await pageResponse.text();
  const htmlMp4Items = normalizeMediaItems(
    extractMp4UrlsFromEmbed(html),
    'video',
    '.mp4'
  );
  if (htmlMp4Items.length > 0) {
    return htmlMp4Items;
  }

  const htmlVideoItems = normalizeMediaItems(
    extractVideoUrlsFromText(html),
    'video',
    '.mp4'
  );
  if (htmlVideoItems.length > 0) {
    return htmlVideoItems;
  }

  const videoUrl = extractMetaContent(html, 'og:video:secure_url') || extractMetaContent(html, 'og:video');
  if (videoUrl && /\.(mp4|mov|m4v)(?:$|\?)/i.test(videoUrl)) {
    return [{
      url: videoUrl,
      extension: getFileExtensionFromUrl(videoUrl, '.mp4'),
      kind: 'video',
    }];
  }

  const imageUrl =
    extractMetaContent(html, 'og:image:secure_url') ||
    extractMetaContent(html, 'og:image') ||
    extractMetaContent(html, 'twitter:image');

  if (imageUrl && !isReel) {
    return [{
      url: imageUrl,
      extension: getFileExtensionFromUrl(imageUrl, '.jpg'),
      kind: 'image',
    }];
  }

  if (isReel) {
    throw new Error('Reel video URL not found.');
  }

  throw new Error('No downloadable preview found for this link.');
}


// Test logic
resolveInstagramMediaInfos('https://www.instagram.com/reel/DW1_l5rk7TR/?igsh=NzVqeTdnOWNqc2Js')
  .then(res => console.log('Result:', res))
  .catch(err => console.error('Error:', err));
    