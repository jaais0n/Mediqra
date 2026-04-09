import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Alert,
  AppState,
  Animated,
  Easing,
  Image,
  NativeModules,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  Linking,
  Share,
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
const HISTORY_STORAGE_FILENAME = 'instasave_history.json';
const MAX_HISTORY_ITEMS = 12;

function getDevServerHostCandidates() {
  const hosts = [];
  const scriptURL = NativeModules?.SourceCode?.scriptURL;
  if (scriptURL) {
    try {
      const parsed = new URL(scriptURL);
      if (parsed.hostname) {
        hosts.push(parsed.hostname);
      }
    } catch {
      // Ignore parse errors and continue with fallbacks.
    }
  }

  const expoHostUri =
    Constants?.expoConfig?.hostUri ||
    Constants?.manifest2?.extra?.expoClient?.hostUri ||
    Constants?.expoGoConfig?.debuggerHost;
  if (expoHostUri && typeof expoHostUri === 'string') {
    const host = expoHostUri.split(':')[0];
    if (host) {
      hosts.push(host);
    }
  }

  const platformServerHost = NativeModules?.PlatformConstants?.ServerHost;
  if (platformServerHost && typeof platformServerHost === 'string') {
    const host = platformServerHost.split(':')[0];
    if (host) {
      hosts.push(host);
    }
  }

  const seen = new Set();
  const ordered = [];
  for (const host of hosts) {
    if (!host || seen.has(host)) {
      continue;
    }
    seen.add(host);
    ordered.push(host);
  }

  return ordered;
}

function getDevServerHost() {
  const candidates = getDevServerHostCandidates();
  if (candidates.length === 0) {
    return null;
  }
  return candidates[0];
}

function buildLocalProxyUrl(targetUrl, referer) {
  const host = getDevServerHost();
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

function buildLocalFreshDownloadUrl(postUrl, index = 0) {
  const host = getDevServerHost();
  try {
    const freshUrl = new URL(`http://${host}:${LOCAL_PROXY_PORT}/download`);
    freshUrl.searchParams.set('postUrl', postUrl);
    freshUrl.searchParams.set('index', String(index));
    return freshUrl.toString();
  } catch {
    return null;
  }
}

function buildLocalExtractUrl(targetUrl) {
  const host = getDevServerHost();
  try {
    const extractUrl = new URL(`http://${host}:${LOCAL_PROXY_PORT}/extract`);
    extractUrl.searchParams.set('url', targetUrl);
    return extractUrl.toString();
  } catch {
    return null;
  }
}

function buildProxyUrlsForAllHosts(targetUrl, referer) {
  return getDevServerHostCandidates()
    .map((host) => {
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
    })
    .filter(Boolean);
}

function buildFreshDownloadUrlsForAllHosts(postUrl, index = 0) {
  return getDevServerHostCandidates()
    .map((host) => {
      try {
        const freshUrl = new URL(`http://${host}:${LOCAL_PROXY_PORT}/download`);
        freshUrl.searchParams.set('postUrl', postUrl);
        freshUrl.searchParams.set('index', String(index));
        return freshUrl.toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getHistoryStoragePath() {
  if (!FileSystem.documentDirectory) {
    return null;
  }

  return `${FileSystem.documentDirectory}${HISTORY_STORAGE_FILENAME}`;
}

async function loadDownloadHistory() {
  const storagePath = getHistoryStoragePath();
  if (!storagePath) {
    return [];
  }

  try {
    const rawValue = await FileSystem.readAsStringAsync(storagePath);
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed?.downloadHistory) ? parsed.downloadHistory : [];
  } catch {
    return [];
  }
}

async function saveDownloadHistory(downloadHistory) {
  const storagePath = getHistoryStoragePath();
  if (!storagePath) {
    return;
  }

  const payload = JSON.stringify({ downloadHistory }, null, 2);
  await FileSystem.writeAsStringAsync(storagePath, payload);
}

function formatSavedTime(timestamp) {
  if (!timestamp) {
    return 'Recently saved';
  }

  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildHistoryTitle(url, kind) {
  const shortcode = extractShortcode(url);
  const label = kind === 'video' ? 'Video' : 'Image';
  return shortcode ? `Instagram ${label} ${shortcode}` : `Instagram ${label}`;
}

function extractIncomingInstagramLink(rawValue) {
  if (!rawValue) {
    return null;
  }

  const directInstagramLink = extractInstagramLink(rawValue);
  if (directInstagramLink) {
    return directInstagramLink;
  }

  try {
    const parsed = new URL(rawValue);
    const sharedLink = parsed.searchParams.get('url');
    if (sharedLink) {
      return extractInstagramLink(sharedLink) || sharedLink;
    }
  } catch {
    // Ignore malformed incoming URLs.
  }

  return null;
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

  // 1. Try passing it to our local extraction proxy first!
  const extractUrl = buildLocalExtractUrl(instagramLink);
  if (extractUrl) {
    try {
      console.log('Trying local extraction backend proxy:', extractUrl);
      const extRes = await fetch(extractUrl, { headers: { Accept: 'application/json' } });
      if (extRes.ok) {
        const extData = await extRes.json();
        const foundUrls = [];

        if (extData && extData.url_list && extData.url_list.length > 0) {
          foundUrls.push(...extData.url_list);
        } else if (extData && extData.media_details && extData.media_details.length > 0) {
          extData.media_details.forEach(item => {
            if (item.url) foundUrls.push(item.url);
          });
        }
        
        const extractedVids = normalizeMediaItems(foundUrls, 'video', '.mp4');
        if (extractedVids.length > 0) {
          console.log('Success via Local Extraction API:', extractedVids.length);
          return extractedVids;
        }
      }
    } catch (e) {
      console.log('Local extraction proxy failed, falling back to native methods:', e?.message);
    }
  }

  // 2. Fallback to native (legacy) attempts
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

export default function App() {
  const [manualLink, setManualLink] = useState('');
  const [autoDetectClipboard, setAutoDetectClipboard] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadHistory, setDownloadHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState('download');
  const [thumbnailFailures, setThumbnailFailures] = useState({});
  const [completionNotice, setCompletionNotice] = useState(null);
  const lastClipboardValueRef = useRef('');
  const contentAnim = useRef(new Animated.Value(1)).current;
  const noticeAnim = useRef(new Animated.Value(0)).current;
  const noticeTimerRef = useRef(null);
  const hasLink = manualLink.trim().length > 0;
  const recentDownloads = downloadHistory.slice(0, 6);
  const favoriteDownloads = downloadHistory.filter((item) => item.favorite);
  const tabs = [
    { id: 'recent', label: 'Recent', icon: 'time-outline', activeIcon: 'time' },
    { id: 'download', label: 'Download', icon: 'paper-plane-outline', activeIcon: 'paper-plane' },
    { id: 'favorites', label: 'Favorites', icon: 'star-outline', activeIcon: 'star' },
  ];

  useEffect(() => {
    contentAnim.setValue(0);
    Animated.timing(contentAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [activeTab, contentAnim]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      const storedHistory = await loadDownloadHistory();
      if (!active) {
        return;
      }

      setDownloadHistory(storedHistory);
      setHistoryLoaded(true);
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!historyLoaded) {
      return;
    }

    saveDownloadHistory(downloadHistory).catch((error) => {
      console.log('Failed to save InstaSave history:', error?.message || error);
    });
  }, [downloadHistory, historyLoaded]);

  useEffect(() => {
    let active = true;

    const applyIncomingUrl = (incomingUrl) => {
      const instagramLink = extractIncomingInstagramLink(incomingUrl);
      if (instagramLink && active) {
        setManualLink(instagramLink);
      }
    };

    Linking.getInitialURL().then((incomingUrl) => {
      if (incomingUrl) {
        applyIncomingUrl(incomingUrl);
      }
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      applyIncomingUrl(url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const checkClipboard = useCallback(async () => {
    if (!autoDetectClipboard) {
      return;
    }

    const clipboardText = await Clipboard.getStringAsync();
    if (!clipboardText || clipboardText === lastClipboardValueRef.current) {
      return;
    }

    lastClipboardValueRef.current = clipboardText;
    const instagramLink = extractInstagramLink(clipboardText);
    if (instagramLink) {
      setManualLink(instagramLink);
    }
  }, [autoDetectClipboard]);

  const recordDownloadHistory = useCallback((instagramLink, mediaInfos) => {
    const normalizedLink = normalizeInstagramPostUrl(instagramLink);
    const now = Date.now();
    const primaryKind = mediaInfos.some((item) => item.kind === 'video') ? 'video' : 'image';
    const entry = {
      url: normalizedLink,
      title: buildHistoryTitle(normalizedLink, primaryKind),
      kind: primaryKind,
      savedAt: now,
      favorite: false,
      fileCount: mediaInfos.length,
      thumbnail: mediaInfos[0]?.url || null,
    };

    setDownloadHistory((currentHistory) => {
      const existingEntry = currentHistory.find((item) => item.url === normalizedLink);
      const mergedEntry = {
        ...entry,
        favorite: existingEntry?.favorite ?? false,
        thumbnail: entry.thumbnail || existingEntry?.thumbnail || null,
      };
      const nextHistory = [
        mergedEntry,
        ...currentHistory.filter((item) => item.url !== normalizedLink),
      ];

      return nextHistory.slice(0, MAX_HISTORY_ITEMS);
    });
  }, []);

  const toggleFavorite = useCallback((url) => {
    setDownloadHistory((currentHistory) =>
      currentHistory.map((item) => (
        item.url === url
          ? { ...item, favorite: !item.favorite }
          : item
      ))
    );
  }, []);

  const openShareSheet = useCallback(async () => {
    const instagramLink = extractInstagramLink(manualLink);
    if (!instagramLink) {
      Alert.alert('Invalid link', 'Paste a valid Instagram link before sharing.');
      return;
    }

    try {
      await Share.share({
        message: instagramLink,
        url: instagramLink,
        title: 'Instagram link',
      });
    } catch {
      Alert.alert('Share unavailable', 'The system share sheet could not be opened.');
    }
  }, [manualLink]);

  const showCompletionNotice = useCallback((title, message) => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }

    setCompletionNotice({ title, message });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    noticeAnim.stopAnimation();
    Animated.timing(noticeAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    noticeTimerRef.current = setTimeout(() => {
      Animated.timing(noticeAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setCompletionNotice(null);
      });
    }, 2600);
  }, [noticeAnim]);

  const openRecentTabFromNotice = useCallback(() => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }

    Animated.timing(noticeAnim, {
      toValue: 0,
      duration: 140,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setCompletionNotice(null);
    });

    setActiveTab('recent');
  }, [noticeAnim]);

  useEffect(() => {
    checkClipboard();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkClipboard();
      }
    });

    return () => {
      appStateSubscription.remove();
    };
  }, [checkClipboard]);

  const downloadFromLink = useCallback(async (instagramLink) => {
    if (isDownloading) {
      return;
    }

    if (!instagramLink) {
      Alert.alert('Invalid link', 'Paste a valid Instagram link to continue.');
      return;
    }

    const normalizedLinkForRequest = normalizeInstagramPostUrl(instagramLink);

    setIsDownloading(true);
    try {
      const mediaInfos = await resolveInstagramMediaInfos(instagramLink);
      if (MediaLibrary.isAvailableAsync && !(await MediaLibrary.isAvailableAsync())) {
        throw new Error('Media library is not available on this device.');
      }

      let savedCount = 0;
      for (let index = 0; index < mediaInfos.length; index += 1) {
        const mediaInfo = mediaInfos[index];
        const targetPath = `${FileSystem.cacheDirectory}instasave_${Date.now()}_${index}${mediaInfo.extension}`;
        const downloadHeaders = {
          ...INSTAGRAM_DOWNLOAD_HEADERS,
          Referer: normalizedLinkForRequest,
        };

        // Force proxy first to bypass device-side Instagram CDN blocks.
        let downloadResult = null;
        const freshDownloadUrl = buildLocalFreshDownloadUrl(normalizedLinkForRequest, index);
        const proxyUrl = buildLocalProxyUrl(mediaInfo.url, normalizedLinkForRequest);
        const freshDownloadCandidates = buildFreshDownloadUrlsForAllHosts(normalizedLinkForRequest, index);
        const proxyCandidates = buildProxyUrlsForAllHosts(mediaInfo.url, normalizedLinkForRequest);

        // For reels/videos, try a fresh server-side URL resolution first (avoids expired URLs).
        if (mediaInfo.kind === 'video') {
          const candidateUrls = freshDownloadCandidates.length > 0
            ? freshDownloadCandidates
            : (freshDownloadUrl ? [freshDownloadUrl] : []);
          for (const candidateUrl of candidateUrls) {
            try {
              downloadResult = await FileSystem.downloadAsync(candidateUrl, targetPath);
            } catch {
              downloadResult = null;
            }
            const status = typeof downloadResult?.status === 'number' ? downloadResult.status : null;
            if (downloadResult && (status === null || status < 400)) {
              break;
            }
          }
        }

        if (!downloadResult) {
          const candidateUrls = proxyCandidates.length > 0
            ? proxyCandidates
            : (proxyUrl ? [proxyUrl] : []);
          for (const candidateUrl of candidateUrls) {
            try {
              downloadResult = await FileSystem.downloadAsync(candidateUrl, targetPath);
            } catch {
              downloadResult = null;
            }
            const status = typeof downloadResult?.status === 'number' ? downloadResult.status : null;
            if (downloadResult && (status === null || status < 400)) {
              break;
            }
          }
        }

        const proxyStatus = typeof downloadResult?.status === 'number' ? downloadResult.status : null;
        if (!downloadResult || (proxyStatus !== null && proxyStatus >= 400)) {
          try {
            downloadResult = await FileSystem.downloadAsync(mediaInfo.url, targetPath, {
              headers: downloadHeaders,
            });
          } catch {
            downloadResult = null;
          }
        }

        if (!downloadResult) {
          throw new Error('Download request failed. Start local proxy with: npm run proxy');
        }

        if (typeof downloadResult.status === 'number' && downloadResult.status >= 400) {
          if (downloadResult.status === 403) {
            try {
              // Retry direct fetch with range header as a last attempt.
              downloadResult = await FileSystem.downloadAsync(mediaInfo.url, targetPath, {
                headers: {
                  ...downloadHeaders,
                  Range: 'bytes=0-',
                },
              });
            } catch {
              // Keep current result for final error handling below.
            }
          }

          if (typeof downloadResult.status === 'number' && downloadResult.status >= 400) {
            throw new Error(`Media download blocked (status ${downloadResult.status}). Ensure proxy is running: npm run proxy`);
          }
        }

        await MediaLibrary.saveToLibraryAsync(downloadResult.uri);
        savedCount += 1;
      }

      if (savedCount === 0) {
        throw new Error('No media files were saved.');
      }

      recordDownloadHistory(instagramLink, mediaInfos);
      setManualLink(normalizedLinkForRequest);
      showCompletionNotice(
        'Download complete',
        `${savedCount} media file${savedCount === 1 ? '' : 's'} saved to your gallery.`
      );
    } catch (error) {
      const errorMessage = typeof error?.message === 'string' ? error.message : '';
      Alert.alert(
        'Download failed',
        errorMessage
          ? `${errorMessage} Try another public post/reel link or use a downloader API.`
          : 'Instagram did not expose a public media URL for this post. Try another public post/reel link or use a downloader API.'
      );
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, recordDownloadHistory, showCompletionNotice]);

  const onDownload = useCallback(() => {
    const instagramLink = extractInstagramLink(manualLink);
    downloadFromLink(instagramLink);
  }, [downloadFromLink, manualLink]);

  const onPaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      return;
    }

    const instagramLink = extractInstagramLink(text);
    if (!instagramLink) {
      Alert.alert('No Instagram link found', 'Your clipboard does not contain an Instagram URL.');
      return;
    }

    setManualLink(instagramLink);
  }, []);

  const clearLink = useCallback(() => {
    setManualLink('');
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />

      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />

      {completionNotice && (
        <Pressable onPress={openRecentTabFromNotice} style={styles.noticePressable}>
          <Animated.View
            style={[
              styles.noticeBanner,
              {
                opacity: noticeAnim,
                transform: [
                  {
                    translateY: noticeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-12, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.noticeDot} />
            <View style={styles.noticeTextWrap}>
              <Text style={styles.noticeTitle}>{completionNotice.title}</Text>
              <Text style={styles.noticeMessage}>{completionNotice.message}</Text>
            </View>
          </Animated.View>
        </Pressable>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.kickerPill}>
            <Text style={styles.kickerText}>InstaSave</Text>
          </View>
          <Text style={styles.title}>Download Instagram media</Text>
          <Text style={styles.subtitle}>
            A minimal workspace to save, organize, and re-download your reels and posts.
          </Text>
        </View>

        <Animated.View
          key={activeTab}
          style={[
            styles.tabPane,
            {
              opacity: contentAnim,
              transform: [
                {
                  translateY: contentAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {activeTab === 'download' && (
            <>
              <View style={styles.featureRow}>
                <View style={styles.featureChip}>
                  <Text style={styles.featureChipText}>Quick save</Text>
                </View>
                <View style={styles.featureChip}>
                  <Text style={styles.featureChipText}>Recent history</Text>
                </View>
                <View style={styles.featureChip}>
                  <Text style={styles.featureChipText}>Favorites</Text>
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.label}>Instagram URL</Text>
                  <Text style={styles.cardHint}>{hasLink ? 'Link ready' : 'Paste a link'}</Text>
                </View>

                <TextInput
                  value={manualLink}
                  onChangeText={setManualLink}
                  placeholder="https://www.instagram.com/reel/..."
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="URL"
                  keyboardType="url"
                  returnKeyType="done"
                  style={styles.input}
                />

                <Text style={styles.helperText}>
                  Paste a public Instagram post or reel URL.
                </Text>

                <View style={styles.primaryActionRow}>
                  <Pressable
                    onPress={onDownload}
                    style={[styles.button, styles.primaryButton, isDownloading && styles.primaryButtonDisabled]}
                  >
                    <Text style={styles.primaryButtonText}>{isDownloading ? 'Downloading...' : 'Download now'}</Text>
                  </Pressable>
                  <Pressable onPress={clearLink} style={[styles.button, styles.iconButton, !hasLink && styles.iconButtonDisabled]} disabled={!hasLink}>
                    <Text style={styles.iconButtonText}>Clear</Text>
                  </Pressable>
                </View>

                <View style={styles.secondaryActionRow}>
                  <Pressable onPress={onPaste} style={[styles.button, styles.secondaryButton]}>
                    <Text style={styles.secondaryButtonText}>Paste link</Text>
                  </Pressable>
                  <Pressable onPress={openShareSheet} style={[styles.button, styles.tertiaryButton]}>
                    <Text style={styles.tertiaryButtonText}>Share link</Text>
                  </Pressable>
                </View>

                <View style={styles.switchRow}>
                  <View style={styles.switchLabelWrap}>
                    <Text style={styles.switchLabel}>Auto-detect copied links</Text>
                    <Text style={styles.switchSubLabel}>Keep this on for faster pasting from Instagram.</Text>
                  </View>
                  <Switch
                    style={styles.switchControl}
                    value={autoDetectClipboard}
                    onValueChange={setAutoDetectClipboard}
                  />
                </View>
              </View>
            </>
          )}

          {activeTab === 'recent' && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Recent downloads</Text>
                <Text style={styles.sectionCount}>{recentDownloads.length}</Text>
              </View>

              {recentDownloads.length === 0 ? (
                <Text style={styles.emptyStateText}>Your recent downloads will appear here after the first save.</Text>
              ) : (
                recentDownloads.map((item) => (
                  <View key={item.url} style={styles.historyItem}>
                    <View style={styles.historyItemContent}>
                      <View style={styles.historyThumbWrap}>
                        {item.thumbnail && !thumbnailFailures[item.url] ? (
                          <Image
                            source={{ uri: item.thumbnail }}
                            style={styles.historyItemThumbnail}
                            resizeMode="cover"
                            onError={() => {
                              setThumbnailFailures((current) => ({
                                ...current,
                                [item.url]: true,
                              }));
                            }}
                          />
                        ) : (
                          <View style={[
                            styles.historyThumbPlaceholder,
                            item.kind === 'video' ? styles.historyThumbPlaceholderVideo : styles.historyThumbPlaceholderImage,
                          ]}>
                            <Ionicons
                              name={item.kind === 'video' ? 'play' : 'image-outline'}
                              size={28}
                              color={item.kind === 'video' ? '#ffffff' : '#0f172a'}
                            />
                            <Text style={[
                              styles.historyThumbFallbackText,
                              item.kind === 'video' ? styles.historyThumbFallbackTextVideo : styles.historyThumbFallbackTextImage,
                            ]}>
                              {item.kind === 'video' ? 'Video' : 'Image'}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Pressable onPress={() => setManualLink(item.url)} style={styles.historyItemMain}>
                        <View style={styles.historyItemTopRow}>
                          <Text style={styles.historyItemTitle} numberOfLines={1}>{item.title}</Text>
                          <Text style={styles.historyItemBadge}>{item.kind === 'video' ? 'Video' : 'Image'}</Text>
                        </View>
                        <Text style={styles.historyItemUrl} numberOfLines={1}>{item.url}</Text>
                        <Text style={styles.historyItemMeta}>
                          {formatSavedTime(item.savedAt)} · {item.fileCount} file{item.fileCount === 1 ? '' : 's'}
                        </Text>
                      </Pressable>
                    </View>

                    <View style={styles.historyActionRow}>
                      <Pressable onPress={() => downloadFromLink(item.url)} style={[styles.historyActionButton, styles.historyPrimaryButton]}>
                        <Text style={styles.historyPrimaryButtonText}>Re-download</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => toggleFavorite(item.url)}
                        style={[styles.historyIconButton, item.favorite && styles.historyIconButtonActive]}
                      >
                        <Text style={[styles.historyIconButtonText, item.favorite && styles.historyIconButtonTextActive]}>
                          {item.favorite ? '★' : '☆'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {activeTab === 'favorites' && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Favorites</Text>
                <Text style={styles.sectionCount}>{favoriteDownloads.length}</Text>
              </View>

              {favoriteDownloads.length === 0 ? (
                <Text style={styles.emptyStateText}>Tap the star on a recent download to pin it here.</Text>
              ) : (
                favoriteDownloads.map((item) => (
                  <View key={item.url} style={styles.favoriteItem}>
                    <View style={styles.favoriteItemContent}>
                      <View style={styles.historyThumbWrap}>
                        {item.thumbnail && !thumbnailFailures[item.url] ? (
                          <Image
                            source={{ uri: item.thumbnail }}
                            style={styles.historyItemThumbnail}
                            resizeMode="cover"
                            onError={() => {
                              setThumbnailFailures((current) => ({
                                ...current,
                                [item.url]: true,
                              }));
                            }}
                          />
                        ) : (
                          <View style={[
                            styles.historyThumbPlaceholder,
                            item.kind === 'video' ? styles.historyThumbPlaceholderVideo : styles.historyThumbPlaceholderImage,
                          ]}>
                            <Ionicons
                              name={item.kind === 'video' ? 'play' : 'image-outline'}
                              size={28}
                              color={item.kind === 'video' ? '#ffffff' : '#0f172a'}
                            />
                            <Text style={[
                              styles.historyThumbFallbackText,
                              item.kind === 'video' ? styles.historyThumbFallbackTextVideo : styles.historyThumbFallbackTextImage,
                            ]}>
                              {item.kind === 'video' ? 'Video' : 'Image'}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Pressable onPress={() => setManualLink(item.url)} style={styles.favoriteItemMain}>
                        <Text style={styles.favoriteTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.favoriteSubtitle} numberOfLines={1}>{item.url}</Text>
                      </Pressable>
                    </View>
                    <View style={styles.favoriteActions}>
                      <Pressable onPress={() => downloadFromLink(item.url)} style={[styles.historyActionButton, styles.historyPrimaryButton]}>
                        <Text style={styles.historyPrimaryButtonText}>Re-download</Text>
                      </Pressable>
                      <Pressable onPress={() => toggleFavorite(item.url)} style={[styles.historyIconButton, styles.historyIconButtonActive]}>
                        <Text style={[styles.historyIconButtonText, styles.historyIconButtonTextActive]}>★</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}
        </Animated.View>

        <View style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>Pro tips</Text>
          <Text style={styles.tipsBody}>
            Use Re-download for quick saves and star your frequent accounts to keep them in Favorites.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.bottomNavBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={styles.bottomNavItem}
            >
              <View
                style={[
                  styles.bottomNavIconShell,
                  isActive && styles.bottomNavIconShellActive,
                ]}
              >
                <Ionicons
                  name={isActive ? tab.activeIcon : tab.icon}
                  size={isActive ? 24 : 22}
                  color={isActive ? '#ffffff' : '#8b93a1'}
                />
              </View>
              {tab.id === 'recent' && recentDownloads.length > 0 && (
                <View style={[styles.bottomNavBadge, isActive && styles.bottomNavBadgeActive]}>
                  <Text style={[styles.bottomNavBadgeText, isActive && styles.bottomNavBadgeTextActive]}>{recentDownloads.length}</Text>
                </View>
              )}
              {tab.id === 'favorites' && favoriteDownloads.length > 0 && (
                <View style={[styles.bottomNavBadge, isActive && styles.bottomNavBadgeActive]}>
                  <Text style={[styles.bottomNavBadgeText, isActive && styles.bottomNavBadgeTextActive]}>{favoriteDownloads.length}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
    position: 'relative',
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -120,
    right: -120,
    width: 280,
    height: 280,
    borderRadius: 120,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -130,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 130,
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
  },
  scrollView: {
    flex: 1,
  },
  noticeBanner: {
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  noticePressable: {
    position: 'absolute',
    top: 14,
    left: 20,
    right: 20,
    zIndex: 20,
  },
  noticeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e',
  },
  noticeTextWrap: {
    flex: 1,
  },
  noticeTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  noticeMessage: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: '#cbd5e1',
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 116,
  },
  header: {
    marginBottom: 10,
  },
  kickerPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 12,
  },
  kickerText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 20,
    color: '#64748b',
  },
  featureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  featureChip: {
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  featureChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  tabPane: {
    marginTop: 4,
  },
  card: {
    marginTop: 10,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cardHint: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d5deea',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  helperText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  button: {
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  iconButton: {
    minWidth: 92,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d5deea',
  },
  iconButtonDisabled: {
    opacity: 0.45,
  },
  iconButtonText: {
    color: '#0f172a',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  secondaryActionRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#d5deea',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  tertiaryButton: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#d5deea',
  },
  tertiaryButtonText: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  switchRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
    paddingTop: 14,
  },
  switchLabelWrap: {
    flex: 1,
    paddingRight: 12,
  },
  switchLabel: {
    fontSize: 13,
    lineHeight: 19,
    color: '#334155',
    fontWeight: '700',
  },
  switchSubLabel: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  switchControl: {
    marginTop: 0,
  },
  sectionCard: {
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: 0,
  },
  sectionCount: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  historyItem: {
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 11,
    marginBottom: 9,
  },
  historyItemMain: {
    flex: 1,
    gap: 4,
  },
  historyItemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  historyItemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  historyItemBadge: {
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    color: '#334155',
    fontSize: 10,
    fontWeight: '800',
  },
  historyItemUrl: {
    fontSize: 12,
    color: '#475569',
  },
  historyItemMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  historyActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  historyActionButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  historyPrimaryButton: {
    backgroundColor: '#0f172a',
  },
  historyPrimaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  historyIconButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d5deea',
  },
  historyIconButtonActive: {
    backgroundColor: '#ecfeff',
    borderColor: '#67e8f9',
  },
  historyIconButtonText: {
    color: '#475569',
    fontSize: 18,
    fontWeight: '800',
  },
  historyIconButtonTextActive: {
    color: '#0e7490',
  },
  favoriteItem: {
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 11,
    marginBottom: 9,
  },
  favoriteItemContent: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  favoriteItemMain: {
    flex: 1,
    gap: 4,
  },
  favoriteTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  favoriteSubtitle: {
    fontSize: 12,
    color: '#64748b',
  },
  favoriteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  tipsCard: {
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
  },
  tipsTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tipsBody: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  bottomNavBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 30,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 11,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 7,
    borderWidth: 1,
    borderColor: '#eef2f7',
    overflow: 'visible',
  },
  bottomNavItem: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    gap: 4,
    position: 'relative',
  },
  bottomNavItemActive: {
    backgroundColor: 'transparent',
  },
  bottomNavItemPressed: {
    opacity: 0.9,
  },
  bottomNavIconShell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f6fa',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  bottomNavIconShellActive: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  bottomNavBadge: {
    position: 'absolute',
    top: 0,
    right: 10,
    minWidth: 16,
    height: 16,
    borderRadius: 999,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf2f7',
  },
  bottomNavBadgeActive: {
    backgroundColor: '#0f172a',
  },
  bottomNavBadgeText: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
    color: '#475569',
  },
  bottomNavBadgeTextActive: {
    color: '#ffffff',
  },
  historyItemContent: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  historyThumbWrap: {
    width: 76,
    height: 76,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe2ea',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  historyThumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  historyThumbPlaceholderVideo: {
    backgroundColor: '#0f172a',
  },
  historyThumbPlaceholderImage: {
    backgroundColor: '#f8fafc',
  },
  historyItemThumbnail: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e0e0e0',
  },
  historyThumbFallbackText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '800',
  },
  historyThumbFallbackTextVideo: {
    color: '#ffffff',
  },
  historyThumbFallbackTextImage: {
    color: '#334155',
  },
});
