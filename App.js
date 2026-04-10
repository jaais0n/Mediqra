import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Alert,
  AppState,
  Animated,
  Easing,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  Linking,
  Platform,
  Share,
} from 'react-native';

const INSTAGRAM_LINK_REGEX = /(https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s]+)/i;
const YOUTUBE_LINK_REGEX = /(https?:\/\/(?:[a-z0-9-]+\.)?(?:youtube\.com|youtu\.be)\/[^\s]+)/i;
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
const DEFAULT_API_BASE_URL = 'https://backendmediqra.vercel.app';
const API_BASE_URL_STORAGE_FILENAME = 'instasave_api_base_url.txt';
const CONFIGURED_API_BASE_URLS = [
  Constants?.expoConfig?.extra?.apiBaseUrl,
  Constants?.manifest2?.extra?.apiBaseUrl,
  DEFAULT_API_BASE_URL,
];
let runtimeApiBaseUrlOverride = '';
const HISTORY_STORAGE_FILENAME = 'instasave_history.json';
const DOWNLOADS_DIRECTORY_URI_FILENAME = 'instasave_downloads_directory_uri.txt';
const LOCAL_DOWNLOADS_DIRNAME = 'downloads';
const MEDIA_SUBFOLDERS = {
  audio: 'MP3',
  video: 'Video',
  image: 'Images',
  other: 'Others',
};
const MAX_HISTORY_ITEMS = 12;

function normalizeApiBaseUrl(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/g, '');
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

function setRuntimeApiBaseUrlOverride(value) {
  runtimeApiBaseUrlOverride = normalizeApiBaseUrl(value) || '';
}

function getConfiguredApiBaseUrlCandidates() {
  const candidates = [];
  const runtimeOverride = normalizeApiBaseUrl(runtimeApiBaseUrlOverride);
  if (runtimeOverride) {
    candidates.push(runtimeOverride);
  }

  for (const configuredBaseUrl of CONFIGURED_API_BASE_URLS) {
    const normalized = normalizeApiBaseUrl(configuredBaseUrl);
    if (normalized) {
      candidates.push(normalized);
    }
  }

  const seen = new Set();
  const ordered = [];
  for (const baseUrl of candidates) {
    if (!baseUrl || seen.has(baseUrl)) {
      continue;
    }
    seen.add(baseUrl);
    ordered.push(baseUrl);
  }

  return ordered;
}

function getBackendBaseUrl() {
  const candidates = getConfiguredApiBaseUrlCandidates();
  if (candidates.length === 0) {
    return null;
  }
  return candidates[0];
}

function isRunningInExpoGo() {
  return Constants?.appOwnership === 'expo';
}

function buildLocalProxyUrl(targetUrl, referer) {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    return null;
  }
  try {
    const proxyUrl = new URL('/proxy', baseUrl);
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
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    return null;
  }
  try {
    const freshUrl = new URL('/download', baseUrl);
    freshUrl.searchParams.set('postUrl', postUrl);
    freshUrl.searchParams.set('index', String(index));
    return freshUrl.toString();
  } catch {
    return null;
  }
}

function buildLocalExtractUrl(targetUrl) {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    return null;
  }
  try {
    const extractUrl = new URL('/extract', baseUrl);
    extractUrl.searchParams.set('url', targetUrl);
    return extractUrl.toString();
  } catch {
    return null;
  }
}

function buildLocalYouTubeExtractUrl(targetUrl) {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    return null;
  }
  try {
    const extractUrl = new URL('/youtube/extract', baseUrl);
    extractUrl.searchParams.set('url', targetUrl);
    return extractUrl.toString();
  } catch {
    return null;
  }
}

function buildLocalYouTubeDownloadUrl(targetUrl, format, formatId = '') {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    return null;
  }
  try {
    const downloadUrl = new URL('/youtube/download', baseUrl);
    downloadUrl.searchParams.set('url', targetUrl);
    downloadUrl.searchParams.set('format', format);
    if (formatId) {
      downloadUrl.searchParams.set('formatId', formatId);
    }
    return downloadUrl.toString();
  } catch {
    return null;
  }
}

function buildProxyUrlsForAllHosts(targetUrl, referer) {
  return getConfiguredApiBaseUrlCandidates()
    .map((baseUrl) => {
      try {
        const proxyUrl = new URL('/proxy', baseUrl);
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
  return getConfiguredApiBaseUrlCandidates()
    .map((baseUrl) => {
      try {
        const freshUrl = new URL('/download', baseUrl);
        freshUrl.searchParams.set('postUrl', postUrl);
        freshUrl.searchParams.set('index', String(index));
        return freshUrl.toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildYouTubeExtractUrlsForAllHosts(targetUrl) {
  return getConfiguredApiBaseUrlCandidates()
    .map((baseUrl) => {
      try {
        const extractUrl = new URL('/youtube/extract', baseUrl);
        extractUrl.searchParams.set('url', targetUrl);
        return extractUrl.toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildYouTubeDownloadUrlsForAllHosts(targetUrl, format, formatId = '') {
  return getConfiguredApiBaseUrlCandidates()
    .map((baseUrl) => {
      try {
        const downloadUrl = new URL('/youtube/download', baseUrl);
        downloadUrl.searchParams.set('url', targetUrl);
        downloadUrl.searchParams.set('format', format);
        if (formatId) {
          downloadUrl.searchParams.set('formatId', formatId);
        }
        return downloadUrl.toString();
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

function getDownloadsDirectoryUriStoragePath() {
  if (!FileSystem.documentDirectory) {
    return null;
  }

  return `${FileSystem.documentDirectory}${DOWNLOADS_DIRECTORY_URI_FILENAME}`;
}

function getApiBaseUrlStoragePath() {
  if (!FileSystem.documentDirectory) {
    return null;
  }

  return `${FileSystem.documentDirectory}${API_BASE_URL_STORAGE_FILENAME}`;
}

async function loadSavedApiBaseUrl() {
  const storagePath = getApiBaseUrlStoragePath();
  if (!storagePath) {
    return null;
  }

  try {
    const existing = await FileSystem.getInfoAsync(storagePath);
    if (!existing?.exists) {
      return null;
    }

    const value = await FileSystem.readAsStringAsync(storagePath);
    return normalizeApiBaseUrl(value || '');
  } catch {
    return null;
  }
}

async function saveApiBaseUrl(value) {
  const storagePath = getApiBaseUrlStoragePath();
  if (!storagePath) {
    return;
  }

  const normalized = normalizeApiBaseUrl(value || '') || '';
  await FileSystem.writeAsStringAsync(storagePath, normalized);
}

function isDownloadsRootDirectoryUri(uri) {
  try {
    const decoded = decodeURIComponent(String(uri || '')).toLowerCase();
    return decoded.includes('/tree/primary:download') && !decoded.includes('/document/');
  } catch {
    return false;
  }
}

function getMediaSubfolderName(kind = '', fileName = '') {
  const loweredKind = String(kind || '').toLowerCase();
  const loweredFileName = String(fileName || '').toLowerCase();

  if (loweredKind === 'audio' || loweredFileName.endsWith('.mp3')) {
    return MEDIA_SUBFOLDERS.audio;
  }

  if (loweredKind === 'video' || loweredFileName.endsWith('.mp4') || loweredFileName.endsWith('.mov') || loweredFileName.endsWith('.m4v')) {
    return MEDIA_SUBFOLDERS.video;
  }

  if (loweredKind === 'image' || loweredFileName.endsWith('.jpg') || loweredFileName.endsWith('.jpeg') || loweredFileName.endsWith('.png') || loweredFileName.endsWith('.webp')) {
    return MEDIA_SUBFOLDERS.image;
  }

  return MEDIA_SUBFOLDERS.other;
}

function isDirectoryUriWithName(uri, dirName) {
  try {
    const decoded = decodeURIComponent(String(uri || '')).toLowerCase();
    return decoded.endsWith(`/${String(dirName || '').toLowerCase()}`);
  } catch {
    return false;
  }
}

function isDirectoryUriWithAnyName(uri, dirNames = []) {
  return dirNames.some((dirName) => isDirectoryUriWithName(uri, dirName));
}

function sanitizeLocalFileName(name, fallbackName = 'downloaded-file') {
  const normalized = String(name || fallbackName)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || fallbackName;
}

function buildSafeSavedFileName(baseName, extension = '') {
  const normalizedExt = extension
    ? (String(extension).startsWith('.') ? String(extension) : `.${String(extension)}`)
    : '';

  const safeBase = sanitizeLocalFileName(baseName, 'downloaded-file')
    .replace(/[.\s]+$/g, '')
    .slice(0, 80)
    .trim();

  const finalBase = safeBase || `download_${Date.now()}`;
  return `${finalBase}${normalizedExt}`;
}

function normalizeBackendErrorMessage(rawMessage, fallbackMessage) {
  let parsedMessage = String(rawMessage || '').trim();
  if (!parsedMessage) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(parsedMessage);
    if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
      parsedMessage = parsed.error.trim();
    }
  } catch {
    // Keep original message when the backend did not return JSON.
  }

  const lowered = parsedMessage.toLowerCase();
  if (lowered.includes('python3') && lowered.includes('no such file')) {
    return 'YouTube is temporarily unavailable on this backend. Use Open web fallback to continue.';
  }
  if (lowered.includes('sign in to confirm you') || lowered.includes('not a bot')) {
    return 'YouTube is temporarily rate-limited on this backend. Use Open web fallback to continue.';
  }

  return parsedMessage;
}

function buildYouTubeWebFallbackUrl(youtubeUrl) {
  const safe = encodeURIComponent(String(youtubeUrl || '').trim());
  return `https://cobalt.tools/?u=${safe}`;
}

function guessMimeTypeFromFileName(fileName, kind = '') {
  const lowered = String(fileName || '').toLowerCase();

  if (lowered.endsWith('.mp4') || kind === 'video') {
    return 'video/mp4';
  }
  if (lowered.endsWith('.mp3') || kind === 'audio') {
    return 'audio/mpeg';
  }
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowered.endsWith('.png')) {
    return 'image/png';
  }
  if (lowered.endsWith('.webp')) {
    return 'image/webp';
  }

  return 'application/octet-stream';
}

async function ensureLocalDownloadsDirectory() {
  if (!FileSystem.documentDirectory) {
    return null;
  }

  const directory = `${FileSystem.documentDirectory}${LOCAL_DOWNLOADS_DIRNAME}/`;
  try {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  } catch {
    // Directory may already exist.
  }

  return directory;
}

async function saveFileToLocalDownloads(sourceUri, preferredFileName) {
  const directory = await ensureLocalDownloadsDirectory();
  if (!directory) {
    return sourceUri;
  }

  const safeName = sanitizeLocalFileName(preferredFileName, `instasave_${Date.now()}`);
  const candidatePath = `${directory}${safeName}`;

  const existing = await FileSystem.getInfoAsync(candidatePath);
  const targetPath = existing?.exists
    ? `${directory}${Date.now()}_${safeName}`
    : candidatePath;

  await FileSystem.copyAsync({ from: sourceUri, to: targetPath });
  return targetPath;
}

async function resolveExistingLocalFileUri(item) {
  const directCandidates = [item?.localFileUri, item?.savedUri].filter(Boolean);

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && /^(content|file):\/\//i.test(candidate)) {
      return candidate;
    }

    try {
      const info = await FileSystem.getInfoAsync(candidate);
      if (info?.exists) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  if (!item?.savedFileName) {
    return null;
  }

  const downloadsDir = await ensureLocalDownloadsDirectory();
  if (!downloadsDir) {
    return null;
  }

  const fallbackPath = `${downloadsDir}${sanitizeLocalFileName(item.savedFileName, item.savedFileName)}`;
  const fallbackInfo = await FileSystem.getInfoAsync(fallbackPath);
  if (fallbackInfo?.exists) {
    return fallbackPath;
  }

  if (typeof item?.savedUri === 'string' && /^(content|file):\/\//i.test(item.savedUri)) {
    return item.savedUri;
  }

  return null;
}

async function resolveOpenableUri(fileUri) {
  if (!fileUri) {
    return null;
  }

  if (Platform.OS === 'android' && typeof FileSystem.getContentUriAsync === 'function') {
    try {
      return await FileSystem.getContentUriAsync(fileUri);
    } catch {
      return fileUri;
    }
  }

  return fileUri;
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

async function loadSavedDownloadsDirectoryUri() {
  const storagePath = getDownloadsDirectoryUriStoragePath();
  if (!storagePath) {
    return null;
  }

  try {
    const value = await FileSystem.readAsStringAsync(storagePath);
    const normalized = String(value || '').trim();
    return isDownloadsRootDirectoryUri(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

async function saveDownloadsDirectoryUri(directoryUri) {
  const storagePath = getDownloadsDirectoryUriStoragePath();
  if (!storagePath) {
    return;
  }

  await FileSystem.writeAsStringAsync(storagePath, String(directoryUri || '').trim());
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

function extractIncomingSupportedLink(rawValue) {
  if (!rawValue) {
    return null;
  }

  const directLink = extractSupportedLink(rawValue);
  if (directLink) {
    return directLink;
  }

  try {
    const parsed = new URL(rawValue);
    const sharedLink = parsed.searchParams.get('url');
    if (sharedLink) {
      return extractSupportedLink(sharedLink) || sharedLink;
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

function extractYouTubeLink(value) {
  if (!value) {
    return null;
  }

  const normalizedText = String(value).trim();
  const directMatch = normalizedText.match(YOUTUBE_LINK_REGEX);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  const tokens = normalizedText.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const candidate = token.replace(/[)\],.;!?]+$/g, '');

    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase();
      if (host.endsWith('youtube.com') || host.endsWith('youtu.be')) {
        return parsed.toString();
      }

      const embedded = parsed.searchParams.get('url');
      if (embedded) {
        const nested = extractYouTubeLink(embedded);
        if (nested) {
          return nested;
        }
      }
    } catch {
      if (/^(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(candidate)) {
        return `https://${candidate}`;
      }
    }
  }

  return null;
}

function extractSupportedLink(value) {
  return extractInstagramLink(value) || extractYouTubeLink(value);
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

function inferInstagramMediaKindFromUrl(url, fallbackKind = 'image') {
  const extension = getFileExtensionFromUrl(url, '');
  if (['.mp4', '.mov', '.m4v'].includes(extension)) {
    return 'video';
  }
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    return 'image';
  }

  return fallbackKind;
}

function extractFilenameFromContentDisposition(contentDispositionValue) {
  if (!contentDispositionValue || typeof contentDispositionValue !== 'string') {
    return null;
  }

  const utf8Match = contentDispositionValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const asciiMatch = contentDispositionValue.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] || null;
}

function extractDownloadedFileName(downloadResult, fallbackName = 'downloaded-file') {
  const headers = downloadResult?.headers || {};
  const contentDisposition =
    headers['Content-Disposition'] ||
    headers['content-disposition'] ||
    headers['CONTENT-DISPOSITION'];
  const fromDisposition = extractFilenameFromContentDisposition(contentDisposition);
  if (fromDisposition) {
    return fromDisposition;
  }

  const uri = downloadResult?.uri || '';
  if (uri) {
    try {
      const pathname = new URL(uri).pathname;
      const fromPath = pathname.split('/').pop();
      if (fromPath) {
        return fromPath;
      }
    } catch {
      const fromPath = String(uri).split('/').pop();
      if (fromPath) {
        return fromPath;
      }
    }
  }

  return fallbackName;
}

function getHistoryItemId(item) {
  return item?.id || `${item?.url || 'item'}_${item?.savedAt || 0}`;
}

function normalizeHistoryItem(item, index = 0) {
  const savedAt = Number(item?.savedAt || 0) || Date.now();
  const normalizedUrl = typeof item?.url === 'string' ? item.url : '';
  const id = item?.id || `${normalizedUrl || 'item'}_${savedAt}_${index}`;

  return {
    ...item,
    id,
    url: normalizedUrl,
    savedAt,
    fileCount: Number(item?.fileCount || 0) || 1,
  };
}

function mergeHistoryCollections(primary = [], secondary = []) {
  const merged = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]
    .map((item, index) => normalizeHistoryItem(item, index));

  if (merged.length === 0) {
    return [];
  }

  const byId = new Map();
  for (const item of merged) {
    const itemId = getHistoryItemId(item);
    const existing = byId.get(itemId);
    if (!existing || Number(item.savedAt || 0) >= Number(existing.savedAt || 0)) {
      byId.set(itemId, item);
    }
  }

  return Array.from(byId.values())
    .sort((left, right) => Number(right?.savedAt || 0) - Number(left?.savedAt || 0))
    .slice(0, MAX_HISTORY_ITEMS);
}

function sanitizeHistoryDisplayTitle(value, fallback = 'Saved download') {
  const normalized = String(value || fallback)
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (normalized || fallback).slice(0, 120);
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

function parseResolutionHeight(value) {
  if (!value || typeof value !== 'string') {
    return 0;
  }

  const lowered = value.toLowerCase();
  const match = lowered.match(/(\d{3,4})p/) || lowered.match(/x(\d{3,4})/);
  return match?.[1] ? Number(match[1]) : 0;
}

function sortYouTubeMp4Options(options = []) {
  return [...options].sort((left, right) => {
    const byFps = Number(right?.fps || 0) - Number(left?.fps || 0);
    if (byFps !== 0) {
      return byFps;
    }

    const byResolution = parseResolutionHeight(right?.resolution) - parseResolutionHeight(left?.resolution);
    if (byResolution !== 0) {
      return byResolution;
    }

    const byAudio = Number(Boolean(right?.hasAudio)) - Number(Boolean(left?.hasAudio));
    if (byAudio !== 0) {
      return byAudio;
    }

    return Number(right?.filesize || 0) - Number(left?.filesize || 0);
  });
}

function sortYouTubeMp3Options(options = []) {
  return [...options].sort((left, right) => {
    const byAbr = Number(right?.abr || 0) - Number(left?.abr || 0);
    if (byAbr !== 0) {
      return byAbr;
    }

    return Number(right?.filesize || 0) - Number(left?.filesize || 0);
  });
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

function extractGraphImageUrls(payload) {
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

    if (typeof media.display_url === 'string') {
      pushUrl(media.display_url);
    }

    if (Array.isArray(media.display_resources)) {
      media.display_resources.forEach((resource) => {
        pushUrl(resource?.src);
      });
    }

    const imageCandidates = media?.image_versions2?.candidates;
    if (Array.isArray(imageCandidates)) {
      imageCandidates.forEach((candidate) => {
        pushUrl(candidate?.url);
      });
    }

    if (Array.isArray(media.carousel_media)) {
      media.carousel_media.forEach((item) => {
        collectFromMedia(item);
      });
    }

    const sidecarEdges = media?.edge_sidecar_to_children?.edges;
    if (Array.isArray(sidecarEdges)) {
      sidecarEdges.forEach((edge) => {
        collectFromMedia(edge?.node);
      });
    }
  };

  if (payload?.graphql?.shortcode_media) {
    collectFromMedia(payload.graphql.shortcode_media);
  }

  if (Array.isArray(payload?.items)) {
    payload.items.forEach((item) => {
      collectFromMedia(item);
    });
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
        const proxyItems = [];
        const details = Array.isArray(extData?.media_details) ? extData.media_details : [];
        const listUrls = Array.isArray(extData?.url_list) ? extData.url_list : [];

        if (details.length > 0) {
          details.forEach((item) => {
            if (!item?.url) {
              return;
            }

            const declaredType = String(item?.type || item?.media_type || '').toLowerCase();
            const kind = declaredType.includes('video')
              ? 'video'
              : declaredType.includes('image')
                ? 'image'
                : inferInstagramMediaKindFromUrl(item.url, isReel ? 'video' : 'image');

            proxyItems.push({
              url: item.url,
              kind,
              extension: getFileExtensionFromUrl(item.url, kind === 'video' ? '.mp4' : '.jpg'),
            });
          });
        }

        // url_list commonly lacks reliable media type metadata.
        if (proxyItems.length === 0 && listUrls.length > 0) {
          listUrls.forEach((url) => {
            if (!url) {
              return;
            }

            const kind = inferInstagramMediaKindFromUrl(url, isReel ? 'video' : 'image');
            proxyItems.push({
              url,
              kind,
              extension: getFileExtensionFromUrl(url, kind === 'video' ? '.mp4' : '.jpg'),
            });
          });
        }

        if (proxyItems.length > 0) {
          const deduped = [];
          const seen = new Set();
          for (const item of proxyItems) {
            if (!item?.url || seen.has(item.url)) {
              continue;
            }
            seen.add(item.url);
            deduped.push(item);
          }

          if (deduped.length > 0) {
            console.log('Success via Local Extraction API:', deduped.length);
            return deduped;
          }
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

      if (!isReel) {
        const graphImages = payload ? extractGraphImageUrls(payload) : [];
        if (graphImages.length > 0) {
          return normalizeMediaItems(graphImages, 'image', '.jpg');
        }
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
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(() => getBackendBaseUrl() || '');
  const [backendCapabilities, setBackendCapabilities] = useState({
    instagram: true,
    youtube: true,
    youtubeMp3Conversion: true,
  });
  const [youtubeOptions, setYoutubeOptions] = useState(null);
  const [isCheckingYouTubeOptions, setIsCheckingYouTubeOptions] = useState(false);
  const [youtubeOptionsError, setYoutubeOptionsError] = useState('');
  const [selectedYouTubeFormat, setSelectedYouTubeFormat] = useState('mp4');
  const [selectedYouTubeMp4FormatId, setSelectedYouTubeMp4FormatId] = useState('');
  const [selectedYouTubeMp3FormatId, setSelectedYouTubeMp3FormatId] = useState('');
  const [autoDetectClipboard, setAutoDetectClipboard] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [downloadProgressLabel, setDownloadProgressLabel] = useState('');
  const [downloadHistory, setDownloadHistory] = useState([]);
  const [isRecentSelectionMode, setIsRecentSelectionMode] = useState(false);
  const [selectedRecentUrls, setSelectedRecentUrls] = useState({});
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState('download');
  const [thumbnailFailures, setThumbnailFailures] = useState({});
  const [completionNotice, setCompletionNotice] = useState(null);
  const lastClipboardValueRef = useRef('');
  const contentAnim = useRef(new Animated.Value(1)).current;
  const noticeAnim = useRef(new Animated.Value(0)).current;
  const noticeTimerRef = useRef(null);
  const resetProgressTimerRef = useRef(null);
  const androidDownloadsDirectoryUriRef = useRef(null);
  const androidMediaSubfolderUriRef = useRef({});
  const instagramLink = extractInstagramLink(manualLink);
  const youtubeLink = extractYouTubeLink(manualLink);
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrlInput);
  const backendConfigured = Boolean(normalizedApiBaseUrl || getBackendBaseUrl());
  const showBackendConfig = __DEV__;
  const backendSupportsYouTube = backendCapabilities.youtube !== false;
  const backendSupportsYouTubeMp3 = backendCapabilities.youtubeMp3Conversion !== false;
  const sourceType = instagramLink ? 'instagram' : (youtubeLink ? 'youtube' : 'unknown');
  const hasLink = sourceType !== 'unknown';
  const activeLink = sourceType === 'youtube' ? youtubeLink : instagramLink;
  const isPotentialYouTubeInput = /(?:youtu\.be|youtube\.com|youtube)/i.test(manualLink);
  const recentDownloads = downloadHistory.slice(0, MAX_HISTORY_ITEMS);
  const favoriteDownloads = downloadHistory.filter((item) => item.favorite);
  const isYouTubeActive = sourceType === 'youtube';
  const showYouTubePanel = backendConfigured && backendSupportsYouTube && (isYouTubeActive || isPotentialYouTubeInput);
  const sourceLabel = isYouTubeActive ? 'YouTube' : 'Instagram';
  const sortedMp4Options = sortYouTubeMp4Options(youtubeOptions?.mp4Options || []).filter((item) => parseResolutionHeight(item?.resolution) >= 720);
  const sortedMp3Options = sortYouTubeMp3Options(youtubeOptions?.mp3Options || []);
  const effectiveYouTubeFormat = !backendSupportsYouTubeMp3 && selectedYouTubeFormat === 'mp3'
    ? 'mp4'
    : selectedYouTubeFormat;
  const selectedYouTubeFormatOptions = effectiveYouTubeFormat === 'mp4' ? sortedMp4Options : sortedMp3Options;
  const selectedYouTubeFormatId = effectiveYouTubeFormat === 'mp4'
    ? selectedYouTubeMp4FormatId
    : (selectedYouTubeMp3FormatId || sortedMp3Options[0]?.formatId || '');
  const maxAvailableFps = sortedMp4Options.reduce((highest, item) => Math.max(highest, Number(item?.fps || 0)), 0);
  const maxAvailableMp3Abr = sortedMp3Options.reduce((highest, item) => Math.max(highest, Number(item?.abr || 0)), 0);
  const tabs = [
    { id: 'recent', label: 'Recent', icon: 'time-outline', activeIcon: 'time' },
    { id: 'download', label: 'Download', icon: 'paper-plane-outline', activeIcon: 'paper-plane' },
    { id: 'favorites', label: 'Favorites', icon: 'star-outline', activeIcon: 'star' },
  ];

  useEffect(() => {
    setRuntimeApiBaseUrlOverride(apiBaseUrlInput);
  }, [apiBaseUrlInput]);

  useEffect(() => {
    let active = true;
    const baseUrl = normalizedApiBaseUrl || getBackendBaseUrl();

    if (!baseUrl) {
      setBackendCapabilities({ instagram: true, youtube: true, youtubeMp3Conversion: true });
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const response = await fetch(new URL('/health', baseUrl).toString(), {
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Health check failed (${response.status})`);
        }

        const data = await response.json();
        if (!active) {
          return;
        }

        setBackendCapabilities({
          instagram: data?.instagram !== false,
          youtube: data?.youtube !== false,
          youtubeMp3Conversion: data?.youtubeMp3Conversion !== false,
        });
      } catch {
        if (!active) {
          return;
        }

        setBackendCapabilities({ instagram: true, youtube: true, youtubeMp3Conversion: true });
      }
    })();

    return () => {
      active = false;
    };
  }, [normalizedApiBaseUrl]);

  useEffect(() => {
    let active = true;

    loadSavedApiBaseUrl()
      .then((savedUrl) => {
        if (!active || !savedUrl) {
          return;
        }
        setApiBaseUrlInput(savedUrl);
        setRuntimeApiBaseUrlOverride(savedUrl);
      })
      .catch(() => {
        // Ignore storage-read errors.
      });

    return () => {
      active = false;
    };
  }, []);

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
    let frameId = null;

    const animateProgress = () => {
      setDisplayProgress((current) => {
        let target = isDownloading ? Math.min(downloadProgress, 0.97) : downloadProgress;

        if (isDownloading && target < 0.08) {
          // Keep progress visually alive when byte callbacks are sparse.
          target = Math.max(target, Math.min(0.35, current + 0.004));
        } else if (isDownloading && target < 0.9) {
          target = Math.max(target, Math.min(0.9, current + 0.0025));
        }

        const delta = target - current;
        if (Math.abs(delta) < 0.002) {
          return target;
        }
        return current + delta * 0.2;
      });

      frameId = requestAnimationFrame(animateProgress);
    };

    animateProgress();

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [downloadProgress, isDownloading]);

  const resetDownloadProgress = useCallback((delayMs = 0) => {
    if (resetProgressTimerRef.current) {
      clearTimeout(resetProgressTimerRef.current);
      resetProgressTimerRef.current = null;
    }

    const runReset = () => {
      setDownloadProgress(0);
      setDisplayProgress(0);
      setDownloadProgressLabel('');
      resetProgressTimerRef.current = null;
    };

    if (delayMs > 0) {
      resetProgressTimerRef.current = setTimeout(runReset, delayMs);
      return;
    }

    runReset();
  }, []);

  const runDownloadWithProgress = useCallback(async (sourceUrl, targetPath, requestOptions, onProgress) => {
    if (typeof FileSystem.createDownloadResumable === 'function') {
      const resumable = FileSystem.createDownloadResumable(
        sourceUrl,
        targetPath,
        requestOptions,
        (progressEvent) => {
          const expected = Number(progressEvent?.totalBytesExpectedToWrite || 0);
          const written = Number(progressEvent?.totalBytesWritten || 0);
          if (expected > 0 && typeof onProgress === 'function') {
            onProgress(Math.max(0, Math.min(1, written / expected)));
          }
        }
      );

      return resumable.downloadAsync();
    }

    return FileSystem.downloadAsync(sourceUrl, targetPath, requestOptions);
  }, []);

  const ensureMediaLibraryPermission = useCallback(async () => {
    if (MediaLibrary.isAvailableAsync && !(await MediaLibrary.isAvailableAsync())) {
      return false;
    }

    if (typeof MediaLibrary.requestPermissionsAsync === 'function') {
      try {
        const granularPermissions = isRunningInExpoGo()
          ? ['photo', 'video']
          : ['photo', 'video', 'audio'];
        const permission = await MediaLibrary.requestPermissionsAsync(false, granularPermissions);
        return Boolean(permission?.granted);
      } catch (error) {
        console.log('Media permission request fallback:', error?.message || error);
        try {
          const permission = await MediaLibrary.requestPermissionsAsync();
          return Boolean(permission?.granted);
        } catch (fallbackError) {
          // Keep download flow alive with local-only save when permission API is unavailable.
          console.log('Media permission request skipped:', fallbackError?.message || fallbackError);
          return false;
        }
      }
    }

    return true;
  }, []);

  const saveToMediaLibraryAndResolveUri = useCallback(async (fileUri) => {
    try {
      const asset = await MediaLibrary.createAssetAsync(fileUri);
      if (Platform.OS === 'android' && asset) {
        try {
          await MediaLibrary.createAlbumAsync('InstaSave', asset, false);
        } catch {
          // Album may already exist; ignore.
        }
      }

      return {
        savedToLibrary: true,
        libraryUri: asset?.uri || fileUri,
      };
    } catch (assetError) {
      console.log('createAssetAsync fallback:', assetError?.message || assetError);
      try {
        await MediaLibrary.saveToLibraryAsync(fileUri);
        return {
          savedToLibrary: true,
          libraryUri: fileUri,
        };
      } catch (libraryError) {
        console.log('saveToLibraryAsync fallback:', libraryError?.message || libraryError);
        return {
          savedToLibrary: false,
          libraryUri: fileUri,
        };
      }
    }
  }, []);

  const saveFileToPhoneDownloads = useCallback(async (sourceUri, preferredFileName, kind = '') => {
    const safeName = sanitizeLocalFileName(preferredFileName, `instasave_${Date.now()}`);

    if (Platform.OS !== 'android' || !FileSystem.StorageAccessFramework) {
      return saveFileToLocalDownloads(sourceUri, safeName);
    }

    const saf = FileSystem.StorageAccessFramework;
    const mimeType = guessMimeTypeFromFileName(safeName, kind);
    const fileNameWithoutExtension = safeName.replace(/\.[^/.]+$/, '') || `instasave_${Date.now()}`;

    const pickDirectoryManually = async () => {
      const initialDownloadsTreeUri = 'content://com.android.externalstorage.documents/tree/primary%3ADownload';
      const manualPermission = await saf.requestDirectoryPermissionsAsync(initialDownloadsTreeUri);
      if (!manualPermission?.granted || !manualPermission?.directoryUri) {
        throw new Error('Folder selection was cancelled.');
      }

      androidDownloadsDirectoryUriRef.current = manualPermission.directoryUri;
      androidMediaSubfolderUriRef.current = {};
      await saveDownloadsDirectoryUri(manualPermission.directoryUri);
      return manualPermission.directoryUri;
    };

    let directoryUri = androidDownloadsDirectoryUriRef.current;
    if (!directoryUri || !isDownloadsRootDirectoryUri(directoryUri)) {
      try {
        directoryUri = await pickDirectoryManually();
      } catch (autoDirectoryError) {
        console.log('Automatic Downloads folder setup failed:', autoDirectoryError?.message || autoDirectoryError);
        directoryUri = await pickDirectoryManually();
      }
    }

    const subfolderName = getMediaSubfolderName(kind, safeName);
    let targetDirectoryUri = androidMediaSubfolderUriRef.current[subfolderName];
    if (!targetDirectoryUri) {
      const existingEntries = await saf.readDirectoryAsync(directoryUri);
      const subfolderAliases = subfolderName === MEDIA_SUBFOLDERS.audio
          ? [MEDIA_SUBFOLDERS.audio, 'Audio']
        : subfolderName === MEDIA_SUBFOLDERS.video
          ? [MEDIA_SUBFOLDERS.video, 'Videos']
          : [subfolderName];

      const existingSubfolderUri = existingEntries.find((entryUri) => isDirectoryUriWithAnyName(entryUri, subfolderAliases));

      if (existingSubfolderUri) {
        targetDirectoryUri = existingSubfolderUri;
      } else {
        targetDirectoryUri = await saf.makeDirectoryAsync(directoryUri, subfolderName);
      }

      androidMediaSubfolderUriRef.current = {
        ...androidMediaSubfolderUriRef.current,
        [subfolderName]: targetDirectoryUri,
      };
    }

    let destinationUri;
    try {
      destinationUri = await saf.createFileAsync(targetDirectoryUri, fileNameWithoutExtension, mimeType);
    } catch (createError) {
      console.log('Primary file create failed:', createError?.message || createError);
      try {
        destinationUri = await saf.createFileAsync(targetDirectoryUri, `${Date.now()}_${fileNameWithoutExtension}`, mimeType);
      } catch {
        directoryUri = await pickDirectoryManually();
        const manualSubfolderName = getMediaSubfolderName(kind, safeName);
        const manualEntries = await saf.readDirectoryAsync(directoryUri);
        const manualAliases = manualSubfolderName === MEDIA_SUBFOLDERS.audio
          ? [MEDIA_SUBFOLDERS.audio, 'Audio']
          : manualSubfolderName === MEDIA_SUBFOLDERS.video
            ? [MEDIA_SUBFOLDERS.video, 'Videos']
            : [manualSubfolderName];

        const manualSubfolderUri = manualEntries.find((entryUri) => isDirectoryUriWithAnyName(entryUri, manualAliases))
          || await saf.makeDirectoryAsync(directoryUri, manualSubfolderName);

        androidMediaSubfolderUriRef.current = {
          ...androidMediaSubfolderUriRef.current,
          [manualSubfolderName]: manualSubfolderUri,
        };

        destinationUri = await saf.createFileAsync(manualSubfolderUri, fileNameWithoutExtension, mimeType);
      }
    }

    const fileBase64 = await FileSystem.readAsStringAsync(sourceUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    await saf.writeAsStringAsync(destinationUri, fileBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return destinationUri;
  }, []);

  useEffect(() => {
    if (!backendSupportsYouTubeMp3 && selectedYouTubeFormat === 'mp3') {
      setSelectedYouTubeFormat('mp4');
    }
  }, [backendSupportsYouTubeMp3, selectedYouTubeFormat]);

  useEffect(() => {
    if (!showYouTubePanel) {
      setYoutubeOptions(null);
      setSelectedYouTubeFormat('mp4');
      setIsCheckingYouTubeOptions(false);
      setYoutubeOptionsError('');
      setSelectedYouTubeMp4FormatId('');
      setSelectedYouTubeMp3FormatId('');
    }
  }, [showYouTubePanel]);

  useEffect(() => {
    if (sortedMp4Options.length > 0 && !sortedMp4Options.some((item) => item?.formatId === selectedYouTubeMp4FormatId)) {
      setSelectedYouTubeMp4FormatId(sortedMp4Options[0]?.formatId || '');
    }

    if (sortedMp3Options.length > 0 && !sortedMp3Options.some((item) => item?.formatId === selectedYouTubeMp3FormatId)) {
      setSelectedYouTubeMp3FormatId(sortedMp3Options[0]?.formatId || '');
    }
  }, [sortedMp4Options, sortedMp3Options, selectedYouTubeMp4FormatId, selectedYouTubeMp3FormatId]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
      if (resetProgressTimerRef.current) {
        clearTimeout(resetProgressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !FileSystem.StorageAccessFramework) {
      return;
    }

    let active = true;
    loadSavedDownloadsDirectoryUri()
      .then((savedDirectoryUri) => {
        if (active && savedDirectoryUri) {
          androidDownloadsDirectoryUriRef.current = savedDirectoryUri;
        }
      })
      .catch(() => {
        // Ignore cache load errors.
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      const storedHistory = await loadDownloadHistory();
      if (!active) {
        return;
      }

      setDownloadHistory((currentHistory) => mergeHistoryCollections(currentHistory, storedHistory));
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
    if (activeTab !== 'recent') {
      return;
    }

    let active = true;
    loadDownloadHistory()
      .then((storedHistory) => {
        if (!active || !Array.isArray(storedHistory) || storedHistory.length === 0) {
          return;
        }

        setDownloadHistory((currentHistory) => mergeHistoryCollections(currentHistory, storedHistory));
      })
      .catch((error) => {
        console.log('Recent refresh failed:', error?.message || error);
      });

    return () => {
      active = false;
    };
  }, [activeTab]);

  useEffect(() => {
    let active = true;

    const applyIncomingUrl = (incomingUrl) => {
      const incomingLink = extractIncomingSupportedLink(incomingUrl);
      if (incomingLink && active) {
        setManualLink(incomingLink);
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
    const supportedLink = extractSupportedLink(clipboardText);
    if (supportedLink) {
      setManualLink(supportedLink);
    }
  }, [autoDetectClipboard]);

  const recordDownloadHistory = useCallback((instagramLink, mediaInfos, saveMeta = null) => {
    const normalizedLink = normalizeInstagramPostUrl(instagramLink);
    const now = Date.now();
    const primaryKind = mediaInfos.some((item) => item.kind === 'video') ? 'video' : 'image';
    setDownloadHistory((currentHistory) => {
      const existingByUrl = currentHistory.find((item) => item.url === normalizedLink);
      const entry = normalizeHistoryItem({
        id: `${now}_${Math.random().toString(36).slice(2, 8)}`,
        url: normalizedLink,
        title: sanitizeHistoryDisplayTitle(buildHistoryTitle(normalizedLink, primaryKind)),
        kind: primaryKind,
        source: 'instagram',
        savedAt: now,
        favorite: existingByUrl?.favorite ?? false,
        fileCount: mediaInfos.length,
        thumbnail: mediaInfos[0]?.url || null,
        savedUri: saveMeta?.savedUri || null,
        localFileUri: saveMeta?.localFileUri || null,
        savedFileName: saveMeta?.savedFileName || null,
      });

      const nextHistory = [
        entry,
        ...currentHistory,
      ];

      return nextHistory.slice(0, MAX_HISTORY_ITEMS);
    });
  }, []);

  const recordYouTubeHistory = useCallback((youtubeUrl, format, meta = null, formatId = '', saveMeta = null) => {
    const now = Date.now();
    const normalizedFormat = format === 'mp3' ? 'mp3' : 'mp4';
    setDownloadHistory((currentHistory) => {
      const existingByUrl = currentHistory.find((item) => item.url === youtubeUrl);
      const entry = normalizeHistoryItem({
        id: `${now}_${Math.random().toString(36).slice(2, 8)}`,
        url: youtubeUrl,
        title: sanitizeHistoryDisplayTitle(meta?.title || `YouTube ${normalizedFormat.toUpperCase()}`),
        kind: normalizedFormat === 'mp3' ? 'audio' : 'video',
        source: 'youtube',
        preferredFormat: normalizedFormat,
        preferredFormatId: formatId || null,
        savedAt: now,
        favorite: existingByUrl?.favorite ?? false,
        fileCount: 1,
        thumbnail: meta?.thumbnail || null,
        savedUri: saveMeta?.savedUri || null,
        localFileUri: saveMeta?.localFileUri || null,
        savedFileName: saveMeta?.savedFileName || null,
      });

      const nextHistory = [
        entry,
        ...currentHistory,
      ];

      return nextHistory.slice(0, MAX_HISTORY_ITEMS);
    });
  }, []);

  const toggleFavorite = useCallback((historyItemId) => {
    setDownloadHistory((currentHistory) =>
      currentHistory.map((item) => (
        getHistoryItemId(item) === historyItemId
          ? { ...item, favorite: !item.favorite }
          : item
      ))
    );
  }, []);

  const toggleRecentSelection = useCallback((url) => {
    setSelectedRecentUrls((current) => ({
      ...current,
      [url]: !current[url],
    }));
  }, []);

  const selectAllRecent = useCallback(() => {
    setSelectedRecentUrls((current) => {
      const next = {};
      for (const item of recentDownloads) {
        next[getHistoryItemId(item)] = true;
      }

      const allAlreadySelected = recentDownloads.length > 0 && recentDownloads.every((item) => current[getHistoryItemId(item)]);
      return allAlreadySelected ? {} : next;
    });
  }, [recentDownloads]);

  const deleteSelectedRecent = useCallback(() => {
    const selectedIds = Object.entries(selectedRecentUrls)
      .filter(([, isSelected]) => Boolean(isSelected))
      .map(([id]) => id);

    if (selectedIds.length === 0) {
      return;
    }

    setDownloadHistory((current) => current.filter((item) => !selectedIds.includes(getHistoryItemId(item))));
    setSelectedRecentUrls({});
    setIsRecentSelectionMode(false);
  }, [selectedRecentUrls]);

  const openDownloadedFile = useCallback(async (item) => {
    const targetUri = await resolveExistingLocalFileUri(item);
    const fallbackUri = item?.savedUri || null;
    if (!targetUri && !fallbackUri) {
      Alert.alert('File unavailable', 'No saved file URI found for this item. Download once again to enable direct open/share.');
      return;
    }

    try {
      const sourceUri = targetUri || fallbackUri;
      const openableUri = await resolveOpenableUri(sourceUri);
      const canOpen = await Linking.canOpenURL(openableUri);
      if (canOpen) {
        await Linking.openURL(openableUri);
        return;
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(sourceUri, {
          dialogTitle: item?.savedFileName || item?.title || 'Open downloaded media',
          mimeType: item?.kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
          UTI: item?.kind === 'audio' ? 'public.mp3' : 'public.movie',
        });
        return;
      }

      throw new Error('No available app could open this URI');
    } catch (error) {
      console.log('Cannot open downloaded file:', error?.message || error);
      Alert.alert('Cannot open file', 'Your device could not open this downloaded file directly. Try Share instead.');
    }
  }, []);

  const shareDownloadedFile = useCallback(async (item) => {
    if (!item) {
      return;
    }

    const targetUri = await resolveExistingLocalFileUri(item);
    const fallbackUri = item?.savedUri || null;
    const sourceUri = targetUri || fallbackUri;
    if (!sourceUri) {
      Alert.alert('File unavailable', 'No local downloaded file is available to share.');
      return;
    }

    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(sourceUri, {
          dialogTitle: item.savedFileName || item.title || 'Share downloaded media',
          mimeType: item.kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
          UTI: item.kind === 'audio' ? 'public.mp3' : 'public.movie',
        });
        return;
      }

      const openableUri = await resolveOpenableUri(sourceUri);
      await Share.share({
        title: item.savedFileName || item.title,
        url: openableUri,
      });
    } catch {
      Alert.alert('Share unavailable', 'The system share sheet could not be opened.');
    }
  }, []);

  const openShareSheet = useCallback(async () => {
    const supportedLink = extractSupportedLink(manualLink);
    if (!supportedLink) {
      Alert.alert('Invalid link', 'Paste a valid Instagram or YouTube link before sharing.');
      return;
    }

    try {
      await Share.share({
        message: supportedLink,
        url: supportedLink,
        title: 'Media link',
      });
    } catch {
      Alert.alert('Share unavailable', 'The system share sheet could not be opened.');
    }
  }, [manualLink]);

  const loadYouTubeOptions = useCallback(async (youtubeUrl) => {
    const candidates = buildYouTubeExtractUrlsForAllHosts(youtubeUrl);
    const fallbackCandidate = buildLocalYouTubeExtractUrl(youtubeUrl);
    const candidateUrls = candidates.length > 0
      ? candidates
      : (fallbackCandidate ? [fallbackCandidate] : []);

    if (candidateUrls.length === 0) {
      throw new Error('Backend API is not configured. Set a production backend URL for YouTube downloads.');
    }

    let lastError = null;
    for (const candidateUrl of candidateUrls) {
      try {
        const response = await fetch(candidateUrl, {
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            normalizeBackendErrorMessage(
              errorText,
              `Extraction failed with status ${response.status}`
            )
          );
        }

        const data = await response.json();
        return {
          title: data?.title || null,
          thumbnail: data?.thumbnail || null,
          mp4Options: Array.isArray(data?.mp4_options) ? data.mp4_options : [],
          mp3Options: Array.isArray(data?.mp3_options) ? data.mp3_options : [],
          mp4Count: Array.isArray(data?.mp4_options) ? data.mp4_options.length : 0,
          mp3Count: Array.isArray(data?.mp3_options) ? data.mp3_options.length : 0,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('YouTube extraction failed.');
  }, []);

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

  const downloadInstagramFromLink = useCallback(async (instagramLinkToDownload) => {
    if (isDownloading) {
      return;
    }

    if (!instagramLinkToDownload) {
      Alert.alert('Invalid link', 'Paste a valid Instagram link to continue.');
      return;
    }

    const normalizedLinkForRequest = normalizeInstagramPostUrl(instagramLinkToDownload);

    setIsDownloading(true);
    try {
      const mediaInfos = await resolveInstagramMediaInfos(instagramLinkToDownload);
      const canSaveToLibrary = await ensureMediaLibraryPermission();

      let savedCount = 0;
      let firstSavedUri = null;
      let firstSavedFileName = null;
      let firstLocalFileUri = null;
      const shortcode = extractShortcode(instagramLinkToDownload) || 'instagram';
      for (let index = 0; index < mediaInfos.length; index += 1) {
        const mediaInfo = mediaInfos[index];
        const targetPath = `${FileSystem.cacheDirectory}instasave_${Date.now()}_${index}${mediaInfo.extension}`;
        const downloadHeaders = {
          ...INSTAGRAM_DOWNLOAD_HEADERS,
          Referer: normalizedLinkForRequest,
        };

        // If a backend is configured, try it first; otherwise rely on the direct media URL.
        let downloadResult = null;
        const freshDownloadUrl = buildLocalFreshDownloadUrl(normalizedLinkForRequest, index);
        const proxyUrl = buildLocalProxyUrl(mediaInfo.url, normalizedLinkForRequest);
        const freshDownloadCandidates = buildFreshDownloadUrlsForAllHosts(normalizedLinkForRequest, index);
        const proxyCandidates = buildProxyUrlsForAllHosts(mediaInfo.url, normalizedLinkForRequest);

        // Try fresh server-side URL resolution first (avoids expired Instagram CDN URLs).
        const freshCandidates = freshDownloadCandidates.length > 0
          ? freshDownloadCandidates
          : (freshDownloadUrl ? [freshDownloadUrl] : []);
        for (const candidateUrl of freshCandidates) {
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
          throw new Error('Download request failed. Configure a production backend URL or try another public Instagram post.');
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
            throw new Error(`Media download blocked (status ${downloadResult.status}). Configure a production backend URL or try another public Instagram post.`);
          }
        }

        const preferredName = buildSafeSavedFileName(`instagram_${shortcode}_${index + 1}`, mediaInfo.extension || '.mp4');
        let localFileUri = downloadResult.uri;
        try {
          localFileUri = await saveFileToPhoneDownloads(downloadResult.uri, preferredName, mediaInfo.kind);
        } catch (persistError) {
          console.log('Phone downloads save failed, trying local app storage:', persistError?.message || persistError);
          try {
            localFileUri = await saveFileToLocalDownloads(downloadResult.uri, preferredName);
          } catch (localFallbackError) {
            console.log('Local copy fallback used for Instagram item:', localFallbackError?.message || localFallbackError);
          }
        }
        const mediaSaveResult = canSaveToLibrary
          ? await saveToMediaLibraryAndResolveUri(localFileUri)
          : { savedToLibrary: false, libraryUri: localFileUri };
        if (!firstSavedUri) {
          firstSavedUri = mediaSaveResult.libraryUri || localFileUri;
        }
        if (!firstLocalFileUri) {
          firstLocalFileUri = localFileUri;
        }
        if (!firstSavedFileName) {
          firstSavedFileName = buildSafeSavedFileName(
            extractDownloadedFileName(downloadResult, preferredName),
            mediaInfo.extension || '.mp4'
          );
        }
        savedCount += 1;
      }

      if (savedCount === 0) {
        throw new Error('No media files were saved.');
      }

      recordDownloadHistory(instagramLinkToDownload, mediaInfos, {
        savedUri: firstSavedUri,
        localFileUri: firstLocalFileUri,
        savedFileName: firstSavedFileName,
      });
      setManualLink(normalizedLinkForRequest);
      showCompletionNotice(
        'Download complete',
        canSaveToLibrary
          ? (savedCount === 1
            ? `${firstSavedFileName || '1 file'} saved to your gallery.`
            : `${savedCount} media files saved to your gallery.`)
          : (savedCount === 1
            ? `${firstSavedFileName || '1 file'} saved locally. Gallery save may be blocked by device permission settings.`
            : `${savedCount} media files saved locally. Gallery save may be blocked by device permission settings.`)
      );
    } catch (error) {
      const errorMessage = typeof error?.message === 'string' ? error.message : '';
      const lowered = errorMessage.toLowerCase();
      const shouldOpenWebFallback =
        lowered.includes('temporarily blocked') ||
        lowered.includes('not a bot') ||
        lowered.includes('innertube unavailable') ||
        lowered.includes('innertube api returned 400');

      if (shouldOpenWebFallback) {
        const fallbackUrl = buildYouTubeWebFallbackUrl(youtubeUrl);
        try {
          const canOpen = await Linking.canOpenURL(fallbackUrl);
          if (canOpen) {
            await Linking.openURL(fallbackUrl);
            Alert.alert('YouTube blocked on backend', 'Opened web fallback so you can continue download there.');
            return;
          }
        } catch {
          // Fall through to normal error alert.
        }
      }

      Alert.alert(
        'Download failed',
        errorMessage
          ? `${errorMessage}`
          : 'Instagram did not expose a public media URL for this post. Use a production backend for better reliability.'
      );
    } finally {
      setIsDownloading(false);
    }
  }, [ensureMediaLibraryPermission, isDownloading, recordDownloadHistory, saveFileToPhoneDownloads, saveToMediaLibraryAndResolveUri, showCompletionNotice]);

  const downloadYouTubeFromLink = useCallback(async (youtubeUrl, preferredFormat, preferredFormatId = '') => {
    if (isDownloading) {
      return;
    }

    if (!youtubeUrl) {
      Alert.alert('Invalid link', 'Paste a valid YouTube link to continue.');
      return;
    }

    const resolvedFormat = preferredFormat === 'mp3' ? 'mp3' : selectedYouTubeFormat;
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadProgressLabel(`Preparing ${resolvedFormat.toUpperCase()} download...`);

    try {
      const canSaveToLibrary = await ensureMediaLibraryPermission();

      const loadedOptions = await loadYouTubeOptions(youtubeUrl);
      setYoutubeOptions(loadedOptions);

      if (resolvedFormat === 'mp3' && !backendSupportsYouTubeMp3) {
        throw new Error('MP3 conversion is not available on this backend. Choose MP4 video.');
      }

      if (resolvedFormat === 'mp3' && loadedOptions.mp3Count === 0) {
        throw new Error('No MP3 stream available for this YouTube video.');
      }

      if (resolvedFormat === 'mp4' && loadedOptions.mp4Count === 0) {
        throw new Error('No MP4 stream available for this YouTube video.');
      }

      const bestMp4From720 = sortYouTubeMp4Options(loadedOptions?.mp4Options || []).filter((item) => parseResolutionHeight(item?.resolution) >= 720);
      const bestMp3Only = sortYouTubeMp3Options(loadedOptions?.mp3Options || []);
      const resolvedFormatId = preferredFormatId || (
        resolvedFormat === 'mp4'
          ? (selectedYouTubeMp4FormatId || bestMp4From720[0]?.formatId || '')
          : (bestMp3Only[0]?.formatId || selectedYouTubeMp3FormatId || '')
      );

      const targetPath = `${FileSystem.cacheDirectory}instasave_yt_${Date.now()}.${resolvedFormat}`;
      const candidates = buildYouTubeDownloadUrlsForAllHosts(youtubeUrl, resolvedFormat, resolvedFormatId);
      const fallbackCandidate = buildLocalYouTubeDownloadUrl(youtubeUrl, resolvedFormat, resolvedFormatId);
      const candidateUrls = candidates.length > 0
        ? candidates
        : (fallbackCandidate ? [fallbackCandidate] : []);

      if (candidateUrls.length === 0) {
        throw new Error('Backend API is not configured. Set a production backend URL for YouTube downloads.');
      }

      let downloadResult = null;
      for (const candidateUrl of candidateUrls) {
        try {
          setDownloadProgress(0);
          setDownloadProgressLabel(`Downloading ${resolvedFormat.toUpperCase()}...`);
          downloadResult = await runDownloadWithProgress(
            candidateUrl,
            targetPath,
            {},
            (ratio) => {
              setDownloadProgress(ratio);
              setDownloadProgressLabel(`Downloading ${resolvedFormat.toUpperCase()}... ${Math.round(ratio * 100)}%`);
            }
          );
        } catch {
          downloadResult = null;
        }

        const status = typeof downloadResult?.status === 'number' ? downloadResult.status : null;
        if (downloadResult && (status === null || status < 400)) {
          break;
        }
      }

      if (!downloadResult) {
        throw new Error('YouTube download failed. Configure a production backend URL before using YouTube downloads.');
      }

      if (typeof downloadResult.status === 'number' && downloadResult.status >= 400) {
        throw new Error(`YouTube download blocked (status ${downloadResult.status}). Configure a production backend URL before using YouTube downloads.`);
      }

      const youtubeTitle = loadedOptions?.title || 'youtube';
      const preferredName = buildSafeSavedFileName(youtubeTitle || 'youtube', `.${resolvedFormat}`);
      let localFileUri = downloadResult.uri;
      try {
        localFileUri = await saveFileToPhoneDownloads(downloadResult.uri, preferredName, resolvedFormat === 'mp3' ? 'audio' : 'video');
      } catch (persistError) {
        console.log('Phone downloads save failed, trying local app storage:', persistError?.message || persistError);
        try {
          localFileUri = await saveFileToLocalDownloads(downloadResult.uri, preferredName);
        } catch (localFallbackError) {
          console.log('Local copy fallback used for YouTube item:', localFallbackError?.message || localFallbackError);
        }
      }
      const savedFileName = buildSafeSavedFileName(
        extractDownloadedFileName(downloadResult, preferredName),
        `.${resolvedFormat}`
      );
      const mediaSaveResult = canSaveToLibrary
        ? await saveToMediaLibraryAndResolveUri(localFileUri)
        : { savedToLibrary: false, libraryUri: localFileUri };
      const savedUri = mediaSaveResult.libraryUri || localFileUri;
      setDownloadProgress(1);
      setDownloadProgressLabel('Finalizing...');
      recordYouTubeHistory(youtubeUrl, resolvedFormat, loadedOptions, resolvedFormatId, {
        savedUri,
        localFileUri,
        savedFileName,
      });
      setManualLink(youtubeUrl);
      showCompletionNotice(
        'Download complete',
        canSaveToLibrary
          ? `${savedFileName} saved to your gallery.`
          : `${savedFileName} saved locally. Gallery save may be blocked by device permission settings.`
      );
    } catch (error) {
      const errorMessage = typeof error?.message === 'string' ? error.message : '';
      Alert.alert(
        'Download failed',
        errorMessage
          ? `${errorMessage}`
          : 'Unable to download this YouTube video right now. Try again shortly.'
      );
    } finally {
      setIsDownloading(false);
      resetDownloadProgress(900);
    }
  }, [backendSupportsYouTubeMp3, ensureMediaLibraryPermission, isDownloading, loadYouTubeOptions, recordYouTubeHistory, resetDownloadProgress, runDownloadWithProgress, saveFileToPhoneDownloads, saveToMediaLibraryAndResolveUri, selectedYouTubeFormat, selectedYouTubeMp3FormatId, selectedYouTubeMp4FormatId, showCompletionNotice]);

  const downloadFromLink = useCallback((link, preferredFormat, preferredFormatId) => {
    const instagramCandidate = extractInstagramLink(link);
    if (instagramCandidate) {
      downloadInstagramFromLink(instagramCandidate);
      return;
    }

    const youtubeCandidate = extractYouTubeLink(link);
    if (youtubeCandidate) {
      if (!backendSupportsYouTube) {
        Alert.alert('Backend does not support YouTube', 'The configured Vercel backend is Instagram-only. Use an Instagram link or deploy a YouTube-capable backend elsewhere.');
        return;
      }
      if (!backendConfigured) {
        Alert.alert('Backend required', 'YouTube downloads require a production backend API URL. Configure `expo.extra.apiBaseUrl` and rebuild the app.');
        return;
      }
      downloadYouTubeFromLink(youtubeCandidate, preferredFormat, preferredFormatId);
      return;
    }

    Alert.alert('Invalid link', 'Paste a valid Instagram or YouTube link to continue.');
  }, [backendConfigured, backendSupportsYouTube, downloadInstagramFromLink, downloadYouTubeFromLink]);

  const onDownload = useCallback(() => {
    if (!backendConfigured) {
      Alert.alert(
        'Service unavailable',
        showBackendConfig
          ? 'Set your production backend API URL first, then try downloading.'
          : 'Download service is not available right now. Please try again shortly.'
      );
      return;
    }

    downloadFromLink(activeLink, effectiveYouTubeFormat, selectedYouTubeFormatId);
  }, [activeLink, backendConfigured, downloadFromLink, effectiveYouTubeFormat, selectedYouTubeFormatId, showBackendConfig]);

  const onSaveBackendUrl = useCallback(async () => {
    const normalized = normalizeApiBaseUrl(apiBaseUrlInput || '');
    if (!normalized) {
      Alert.alert('Invalid backend URL', 'Enter a valid API URL like https://api.yourdomain.com');
      return;
    }

    setApiBaseUrlInput(normalized);
    setRuntimeApiBaseUrlOverride(normalized);
    try {
      await saveApiBaseUrl(normalized);
      try {
        const response = await fetch(new URL('/health', normalized).toString(), {
          headers: { Accept: 'application/json' },
        });
        if (response.ok) {
          const data = await response.json();
          setBackendCapabilities({
            instagram: data?.instagram !== false,
            youtube: data?.youtube !== false,
            youtubeMp3Conversion: data?.youtubeMp3Conversion !== false,
          });
        }
      } catch {
        // Ignore capability check errors here; the app will fall back gracefully.
      }

      Alert.alert('Backend saved', `API base URL set to ${normalized}`);
    } catch {
      Alert.alert('Save failed', 'Could not persist backend URL on this device.');
    }
  }, [apiBaseUrlInput]);

  const onCheckYouTubeOptions = useCallback(async () => {
    if (!youtubeLink) {
      setYoutubeOptionsError('Enter a full YouTube URL to load formats.');
      Alert.alert('Invalid link', 'Paste a valid YouTube link first.');
      return;
    }

    setYoutubeOptionsError('');
    setIsCheckingYouTubeOptions(true);
    try {
      const options = await loadYouTubeOptions(youtubeLink);
      setYoutubeOptions(options);
    } catch (error) {
      const message = typeof error?.message === 'string' ? error.message : 'Could not load YouTube formats.';
      setYoutubeOptionsError(message);
      Alert.alert('Format check failed', message);
    } finally {
      setIsCheckingYouTubeOptions(false);
    }
  }, [loadYouTubeOptions, youtubeLink]);

  const onOpenYouTubeWebFallback = useCallback(async () => {
    if (!youtubeLink) {
      Alert.alert('Missing YouTube link', 'Paste a valid YouTube URL first.');
      return;
    }

    const fallbackUrl = buildYouTubeWebFallbackUrl(youtubeLink);
    try {
      const supported = await Linking.canOpenURL(fallbackUrl);
      if (!supported) {
        Alert.alert('Cannot open browser', 'Your device cannot open the fallback page right now.');
        return;
      }
      await Linking.openURL(fallbackUrl);
    } catch {
      Alert.alert('Open failed', 'Could not open the fallback page. Please try again.');
    }
  }, [youtubeLink]);

  useEffect(() => {
    let cancelled = false;

    if (!youtubeLink) {
      if (showYouTubePanel && manualLink.trim().length > 0) {
        setYoutubeOptionsError('Enter a full YouTube URL to load formats.');
      }
      return () => {
        cancelled = true;
      };
    }

    setYoutubeOptionsError('');
    setIsCheckingYouTubeOptions(true);
    loadYouTubeOptions(youtubeLink)
      .then((options) => {
        if (!cancelled) {
          setYoutubeOptions(options);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setYoutubeOptions(null);
          const message = typeof error?.message === 'string' ? error.message : 'Could not load YouTube formats.';
          setYoutubeOptionsError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingYouTubeOptions(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [youtubeLink, manualLink, showYouTubePanel, loadYouTubeOptions]);

  const onPaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      return;
    }

    const supportedLink = extractSupportedLink(text);
    if (!supportedLink) {
      Alert.alert('No supported link found', 'Your clipboard does not contain an Instagram or YouTube URL.');
      return;
    }

    setManualLink(supportedLink);
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
            <Text style={styles.kickerText}>Mediqra</Text>
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
                  <Text style={styles.label}>{sourceLabel} URL</Text>
                  <Text style={styles.cardHint}>{hasLink ? 'Link ready' : 'Paste a link'}</Text>
                </View>

                <TextInput
                  value={manualLink}
                  onChangeText={setManualLink}
                  placeholder="https://www.instagram.com/reel/... or https://youtu.be/..."
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
                  Paste a public Instagram or YouTube URL.
                </Text>
                <Text style={styles.helperTextSecondary}>
                  Files are saved to app local storage first, and then to gallery when device permissions allow it.
                </Text>

                {showBackendConfig && (
                  <View style={styles.backendConfigCard}>
                    <View style={styles.backendConfigHeader}>
                      <Text style={styles.backendConfigTitle}>Production backend API URL</Text>
                      <Text style={[styles.backendConfigStatus, backendConfigured ? styles.backendConfigStatusOk : styles.backendConfigStatusWarn]}>
                        {backendConfigured ? 'Configured' : 'Required'}
                      </Text>
                    </View>
                    <TextInput
                      value={apiBaseUrlInput}
                      onChangeText={setApiBaseUrlInput}
                      placeholder="https://api.yourdomain.com"
                      placeholderTextColor="#94a3b8"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      textContentType="URL"
                      keyboardType="url"
                      returnKeyType="done"
                      style={styles.backendConfigInput}
                    />
                    <Pressable onPress={onSaveBackendUrl} style={styles.backendConfigButton}>
                      <Text style={styles.backendConfigButtonText}>Save backend URL</Text>
                    </Pressable>
                  </View>
                )}

                {showYouTubePanel && (
                  <View style={styles.youtubePanel}>
                    <Text style={styles.youtubePanelTitle}>YouTube format</Text>
                    <View style={styles.youtubeFormatRow}>
                      <Pressable
                        style={[
                          styles.youtubeFormatChip,
                          selectedYouTubeFormat === 'mp4' && styles.youtubeFormatChipActive,
                        ]}
                        onPress={() => setSelectedYouTubeFormat('mp4')}
                      >
                        <Text
                          style={[
                            styles.youtubeFormatChipText,
                            selectedYouTubeFormat === 'mp4' && styles.youtubeFormatChipTextActive,
                          ]}
                        >
                          MP4 Video
                        </Text>
                      </Pressable>
                      {backendSupportsYouTubeMp3 && (
                        <Pressable
                          style={[
                            styles.youtubeFormatChip,
                            selectedYouTubeFormat === 'mp3' && styles.youtubeFormatChipActive,
                          ]}
                          onPress={() => setSelectedYouTubeFormat('mp3')}
                        >
                          <Text
                            style={[
                              styles.youtubeFormatChipText,
                              selectedYouTubeFormat === 'mp3' && styles.youtubeFormatChipTextActive,
                            ]}
                          >
                            MP3 Audio
                          </Text>
                        </Pressable>
                      )}
                    </View>

                    {!backendSupportsYouTubeMp3 && (
                      <Text style={styles.youtubeInfoText}>This backend supports MP4 only. MP3 conversion is disabled.</Text>
                    )}

                    <Pressable style={styles.youtubeCheckButton} onPress={onCheckYouTubeOptions}>
                      <Text style={styles.youtubeCheckButtonText}>{isCheckingYouTubeOptions ? 'Checking formats...' : 'Check available formats'}</Text>
                    </Pressable>

                    {isCheckingYouTubeOptions && !youtubeOptions && (
                      <Text style={styles.youtubeInfoText}>Fetching available formats...</Text>
                    )}

                    {youtubeOptions && (
                      <View style={styles.youtubeFormatsWrap}>
                        <Text style={styles.youtubeInfoText}>
                          {youtubeOptions.title ? `${youtubeOptions.title} • ` : ''}
                          {sortedMp4Options.length} MP4 option{sortedMp4Options.length === 1 ? '' : 's'} from 720p+ • Max FPS {maxAvailableFps || 'N/A'}{backendSupportsYouTubeMp3 ? ` • MP3 max ${maxAvailableMp3Abr ? `${Math.round(maxAvailableMp3Abr)} kbps` : 'N/A'}` : ' • MP3 unavailable on this backend'}
                        </Text>

                        <View style={styles.youtubeTypesGroup}>
                          <Text style={styles.youtubeTypesHeading}>
                            {effectiveYouTubeFormat === 'mp4' ? 'MP4 types (720p to max)' : 'MP3 highest quality'}
                          </Text>

                          {effectiveYouTubeFormat === 'mp4' && selectedYouTubeFormatOptions.length === 0 ? (
                            <Text style={styles.youtubeTypeItem}>No MP4 formats found from 720p or higher.</Text>
                          ) : (
                            effectiveYouTubeFormat === 'mp4' ? selectedYouTubeFormatOptions.map((opt, idx) => {
                              const formatId = opt?.formatId || '';
                              const selected = formatId === selectedYouTubeFormatId;
                              const label = `${opt?.resolution || 'video'}${opt?.fps ? ` · ${opt.fps}fps` : ''}${opt?.hasAudio ? ' · with audio' : ' · video only'}`;

                              return (
                                <Pressable
                                  key={`${effectiveYouTubeFormat}-${formatId || idx}`}
                                  style={[styles.youtubeTypeItemButton, selected && styles.youtubeTypeItemButtonActive]}
                                  onPress={() => {
                                    if (effectiveYouTubeFormat === 'mp4') {
                                      setSelectedYouTubeMp4FormatId(formatId);
                                    } else {
                                      setSelectedYouTubeMp3FormatId(formatId);
                                    }
                                  }}
                                >
                                  <Text style={[styles.youtubeTypeItem, selected && styles.youtubeTypeItemActive]}>{label}</Text>
                                  <Text style={[styles.youtubeTypeMeta, selected && styles.youtubeTypeMetaActive]}>
                                    {selected ? 'Selected' : 'Tap to select'}
                                  </Text>
                                </Pressable>
                              );
                            }) : (
                              sortedMp3Options[0] ? (
                                <View style={[styles.youtubeTypeItemButton, styles.youtubeTypeItemButtonActive]}>
                                  <Text style={[styles.youtubeTypeItem, styles.youtubeTypeItemActive]}>
                                    {sortedMp3Options[0]?.abr ? `${Math.round(sortedMp3Options[0].abr)} kbps` : 'audio'}{sortedMp3Options[0]?.asr ? ` · ${Math.round(sortedMp3Options[0].asr / 1000)} kHz` : ''}
                                  </Text>
                                  <Text style={[styles.youtubeTypeMeta, styles.youtubeTypeMetaActive]}>Highest quality selected automatically</Text>
                                </View>
                              ) : (
                                <Text style={styles.youtubeTypeItem}>No MP3 stream found for this video.</Text>
                              )
                            )
                          )}
                        </View>
                      </View>
                    )}

                    {!!youtubeOptionsError && (
                      <>
                        <Text style={styles.youtubeErrorText}>{youtubeOptionsError}</Text>
                        <Pressable style={styles.youtubeFallbackButton} onPress={onOpenYouTubeWebFallback}>
                          <Text style={styles.youtubeFallbackButtonText}>Open web fallback</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                )}

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

                {isDownloading && sourceType === 'youtube' && !!downloadProgressLabel && (
                  <View style={styles.progressWrap}>
                    <Text style={styles.progressLabel}>{downloadProgressLabel}</Text>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${Math.max(3, Math.round(displayProgress * 100))}%` }]} />
                    </View>
                  </View>
                )}

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
                <View style={styles.recentHeaderActions}>
                  <Text style={styles.sectionCount}>{recentDownloads.length}</Text>
                  <Pressable
                    onPress={() => {
                      setIsRecentSelectionMode((current) => !current);
                      setSelectedRecentUrls({});
                    }}
                    style={styles.recentHeaderButton}
                  >
                    <Text style={styles.recentHeaderButtonText}>{isRecentSelectionMode ? 'Done' : 'Select'}</Text>
                  </Pressable>
                </View>
              </View>

              {isRecentSelectionMode && recentDownloads.length > 0 && (
                <View style={styles.recentSelectionRow}>
                  <Pressable onPress={selectAllRecent} style={styles.recentSelectionButton}>
                    <Text style={styles.recentSelectionButtonText}>Select all</Text>
                  </Pressable>
                  <Pressable onPress={deleteSelectedRecent} style={[styles.recentSelectionButton, styles.recentDeleteButton]}>
                    <Text style={[styles.recentSelectionButtonText, styles.recentDeleteButtonText]}>Delete selected</Text>
                  </Pressable>
                </View>
              )}

              {recentDownloads.length === 0 ? (
                <Text style={styles.emptyStateText}>Your recent downloads will appear here after the first save.</Text>
              ) : (
                recentDownloads.map((item) => {
                  const itemId = getHistoryItemId(item);
                  return (
                  <View key={itemId} style={styles.historyItem}>
                    <View style={styles.historyItemContent}>
                      {isRecentSelectionMode && (
                        <Pressable
                          onPress={() => toggleRecentSelection(itemId)}
                          style={[styles.recentCheckbox, selectedRecentUrls[itemId] && styles.recentCheckboxActive]}
                        >
                          <Text style={[styles.recentCheckboxText, selectedRecentUrls[itemId] && styles.recentCheckboxTextActive]}>
                            {selectedRecentUrls[itemId] ? '✓' : ''}
                          </Text>
                        </Pressable>
                      )}
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
                            item.kind === 'video' || item.kind === 'audio'
                              ? styles.historyThumbPlaceholderVideo
                              : styles.historyThumbPlaceholderImage,
                          ]}>
                            <Ionicons
                              name={item.kind === 'video' ? 'play' : (item.kind === 'audio' ? 'musical-notes' : 'image-outline')}
                              size={28}
                              color={item.kind === 'video' || item.kind === 'audio' ? '#ffffff' : '#0f172a'}
                            />
                            <Text style={[
                              styles.historyThumbFallbackText,
                              item.kind === 'video' || item.kind === 'audio'
                                ? styles.historyThumbFallbackTextVideo
                                : styles.historyThumbFallbackTextImage,
                            ]}>
                              {item.kind === 'video' ? 'Video' : (item.kind === 'audio' ? 'Audio' : 'Image')}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Pressable onPress={() => setManualLink(item.url)} style={styles.historyItemMain}>
                        <View style={styles.historyItemTopRow}>
                          <Text style={styles.historyItemTitle} numberOfLines={1}>{item.title}</Text>
                          <Text style={styles.historyItemBadge}>{item.kind === 'video' ? 'Video' : (item.kind === 'audio' ? 'Audio' : 'Image')}</Text>
                        </View>
                        <Text style={styles.historyItemUrl} numberOfLines={1}>{item.url}</Text>
                        <Text style={styles.historyItemMeta}>
                          {formatSavedTime(item.savedAt)} · {item.fileCount} file{item.fileCount === 1 ? '' : 's'}
                        </Text>
                      </Pressable>
                    </View>

                    <View style={styles.historyActionRow}>
                      <Pressable onPress={() => openDownloadedFile(item)} style={[styles.historyActionButton, styles.historyPrimaryButton]}>
                        <Text style={styles.historyPrimaryButtonText}>View download</Text>
                      </Pressable>
                      <Pressable onPress={() => shareDownloadedFile(item)} style={[styles.historyIconButton, styles.historyShareIconButton]}>
                        <Ionicons name="share-social-outline" size={18} color="#334155" />
                      </Pressable>
                      <Pressable
                        onPress={() => toggleFavorite(itemId)}
                        style={[styles.historyIconButton, item.favorite && styles.historyIconButtonActive]}
                      >
                        <Text style={[styles.historyIconButtonText, item.favorite && styles.historyIconButtonTextActive]}>
                          {item.favorite ? '★' : '☆'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );})
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
                favoriteDownloads.map((item) => {
                  const itemId = getHistoryItemId(item);
                  return (
                  <View key={itemId} style={styles.favoriteItem}>
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
                            item.kind === 'video' || item.kind === 'audio'
                              ? styles.historyThumbPlaceholderVideo
                              : styles.historyThumbPlaceholderImage,
                          ]}>
                            <Ionicons
                              name={item.kind === 'video' ? 'play' : (item.kind === 'audio' ? 'musical-notes' : 'image-outline')}
                              size={28}
                              color={item.kind === 'video' || item.kind === 'audio' ? '#ffffff' : '#0f172a'}
                            />
                            <Text style={[
                              styles.historyThumbFallbackText,
                              item.kind === 'video' || item.kind === 'audio'
                                ? styles.historyThumbFallbackTextVideo
                                : styles.historyThumbFallbackTextImage,
                            ]}>
                              {item.kind === 'video' ? 'Video' : (item.kind === 'audio' ? 'Audio' : 'Image')}
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
                      <Pressable onPress={() => downloadFromLink(item.url, item.preferredFormat, item.preferredFormatId)} style={[styles.historyActionButton, styles.historyPrimaryButton]}>
                        <Text style={styles.historyPrimaryButtonText}>Re-download</Text>
                      </Pressable>
                      <Pressable onPress={() => toggleFavorite(itemId)} style={[styles.historyIconButton, styles.historyIconButtonActive]}>
                        <Text style={[styles.historyIconButtonText, styles.historyIconButtonTextActive]}>★</Text>
                      </Pressable>
                    </View>
                  </View>
                );})
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
  helperTextSecondary: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    color: '#94a3b8',
  },
  backendConfigCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  backendConfigHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  backendConfigTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#0f172a',
    flex: 1,
    marginRight: 8,
  },
  backendConfigStatus: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  backendConfigStatusOk: {
    color: '#059669',
  },
  backendConfigStatusWarn: {
    color: '#b45309',
  },
  backendConfigInput: {
    borderWidth: 1,
    borderColor: '#d5deea',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  backendConfigButton: {
    marginTop: 8,
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0f172a',
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  backendConfigButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  youtubePanel: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  youtubePanelTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  youtubeFormatRow: {
    flexDirection: 'row',
    gap: 8,
  },
  youtubeFormatChip: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
  },
  youtubeFormatChipActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  youtubeFormatChipText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#334155',
  },
  youtubeFormatChipTextActive: {
    color: '#ffffff',
  },
  youtubeCheckButton: {
    marginTop: 8,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d5deea',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  youtubeCheckButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#334155',
  },
  youtubeInfoText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  youtubeFormatsWrap: {
    marginTop: 2,
    gap: 8,
  },
  youtubeTypesGroup: {
    borderWidth: 1,
    borderColor: '#dbe3ee',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  youtubeTypesHeading: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  youtubeTypeItem: {
    fontSize: 12,
    lineHeight: 17,
    color: '#475569',
    fontWeight: '600',
  },
  youtubeTypeItemButton: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    marginTop: 4,
  },
  youtubeTypeItemButtonActive: {
    borderColor: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  youtubeTypeItemActive: {
    color: '#0f172a',
    fontWeight: '800',
  },
  youtubeTypeMeta: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 14,
    color: '#64748b',
    fontWeight: '600',
  },
  youtubeTypeMetaActive: {
    color: '#0f172a',
  },
  youtubeErrorText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#b91c1c',
  },
  youtubeFallbackButton: {
    marginTop: 8,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0f172a',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  youtubeFallbackButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#0f172a',
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
  progressWrap: {
    marginTop: 10,
    gap: 6,
  },
  progressLabel: {
    fontSize: 12,
    lineHeight: 17,
    color: '#334155',
    fontWeight: '700',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#0f172a',
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
  recentHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recentHeaderButton: {
    minHeight: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d5deea',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentHeaderButtonText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    color: '#334155',
  },
  recentSelectionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  recentSelectionButton: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d5deea',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  recentSelectionButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#334155',
  },
  recentDeleteButton: {
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  recentDeleteButtonText: {
    color: '#b91c1c',
  },
  recentCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  recentCheckboxActive: {
    borderColor: '#0f172a',
    backgroundColor: '#0f172a',
  },
  recentCheckboxText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  recentCheckboxTextActive: {
    color: '#ffffff',
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
  historySecondaryActionButton: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#d5deea',
  },
  historyShareIconButton: {
    backgroundColor: '#f8fafc',
    borderColor: '#d5deea',
  },
  historySecondaryActionText: {
    color: '#334155',
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
