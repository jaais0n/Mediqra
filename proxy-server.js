const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { instagramGetUrl } = require('instagram-url-direct');
const ytDlp = require('yt-dlp-exec');
const ffmpegPath = require('ffmpeg-static');

const PORT = Number(process.env.INSTASAVE_PROXY_PORT || 8787);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

function isAllowedHost(hostname) {
  if (!hostname) {
    return false;
  }

  const host = hostname.toLowerCase();
  return host.endsWith('instagram.com') || host.endsWith('fbcdn.net') || host.endsWith('cdninstagram.com');
}

function isAllowedYouTubeHost(hostname) {
  if (!hostname) {
    return false;
  }

  const host = hostname.toLowerCase();
  return host.endsWith('youtube.com') || host.endsWith('youtu.be') || host.endsWith('googlevideo.com');
}

function isYouTubeUrl(target) {
  try {
    const parsed = new URL(target);
    return isAllowedYouTubeHost(parsed.hostname);
  } catch {
    return false;
  }
}

function sanitizeFileSegment(value) {
  return String(value || 'youtube')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'youtube';
}

async function getYouTubeInfo(videoUrl) {
  const result = await ytDlp.exec(videoUrl, {
    dumpSingleJson: true,
    noPlaylist: true,
    noWarnings: true,
    noCallHome: true,
    ffmpegLocation: ffmpegPath || undefined,
  });

  if (!result?.stdout) {
    throw new Error('No metadata returned from yt-dlp');
  }

  return JSON.parse(result.stdout);
}

function pickYouTubeOptions(info) {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const mp4Options = formats
    .filter((format) => format?.ext === 'mp4' && format?.vcodec !== 'none')
    .sort((left, right) => {
      const rightFps = Number(right?.fps || 0);
      const leftFps = Number(left?.fps || 0);
      if (rightFps !== leftFps) {
        return rightFps - leftFps;
      }

      const leftHeight = Number(String(left?.height || 0).replace(/[^0-9]/g, '')) || 0;
      const rightHeight = Number(String(right?.height || 0).replace(/[^0-9]/g, '')) || 0;
      if (rightHeight !== leftHeight) {
        return rightHeight - leftHeight;
      }

      return Number(right?.filesize || right?.filesize_approx || 0) - Number(left?.filesize || left?.filesize_approx || 0);
    })
    .map((format) => ({
      formatId: format.format_id,
      ext: format.ext,
      resolution: format.resolution || format.quality_label || null,
      fps: format.fps || null,
      hasAudio: format.acodec !== 'none',
      hasVideo: format.vcodec !== 'none',
      filesize: format.filesize || format.filesize_approx || null,
      url: format.url,
    }))
    .slice(0, 30);

  const mp3Options = formats
    .filter((format) => format?.acodec !== 'none' && format?.vcodec === 'none')
    .sort((left, right) => {
      const rightAbr = Number(right?.abr || 0);
      const leftAbr = Number(left?.abr || 0);
      if (rightAbr !== leftAbr) {
        return rightAbr - leftAbr;
      }

      const rightAsr = Number(right?.asr || 0);
      const leftAsr = Number(left?.asr || 0);
      if (rightAsr !== leftAsr) {
        return rightAsr - leftAsr;
      }

      return Number(right?.filesize || right?.filesize_approx || 0) - Number(left?.filesize || left?.filesize_approx || 0);
    })
    .map((format) => ({
      formatId: format.format_id,
      ext: format.ext,
      abr: format.abr || null,
      asr: format.asr || null,
      filesize: format.filesize || format.filesize_approx || null,
      url: format.url,
    }))
    .slice(0, 30);

  return { mp4Options, mp3Options };
}

async function cleanupDirectory(directoryPath) {
  try {
    await fsPromises.rm(directoryPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function copyHeader(upstream, res, name) {
  const value = upstream.headers.get(name);
  if (value) {
    res.setHeader(name, value);
  }
}

async function proxyUpstreamUrl(req, res, target, referer = 'https://www.instagram.com/') {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.statusCode = 400;
    res.end('Invalid target URL');
    return;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    res.statusCode = 400;
    res.end('Unsupported protocol');
    return;
  }

  if (!isAllowedHost(parsed.hostname)) {
    res.statusCode = 403;
    res.end('Host not allowed');
    return;
  }

  try {
    const upstreamHeaders = {
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
      Origin: 'https://www.instagram.com',
      Referer: referer,
    };

    if (req.headers.range) {
      upstreamHeaders.Range = req.headers.range;
    }

    let upstream = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: upstreamHeaders,
    });

    // Instagram CDN can reject some requests with strict anti-bot checks.
    // Retry with an alternate mobile-like header set before failing.
    if (upstream.status === 403) {
      const retryHeaders = {
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Mobile Safari/537.36',
        Referer: referer,
        'Sec-Fetch-Dest': 'video',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      };

      if (req.headers.range) {
        retryHeaders.Range = req.headers.range;
      }

      upstream = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        headers: retryHeaders,
      });
    }

    res.statusCode = upstream.status;
    copyHeader(upstream, res, 'content-type');
    copyHeader(upstream, res, 'content-length');
    copyHeader(upstream, res, 'content-disposition');
    copyHeader(upstream, res, 'accept-ranges');
    copyHeader(upstream, res, 'cache-control');

    if (!upstream.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    res.statusCode = 500;
    res.end(`Proxy error: ${error?.message || 'unknown error'}`);
  }
}

async function handleProxy(req, res, reqUrl) {
  const target = reqUrl.searchParams.get('url');
  const referer = reqUrl.searchParams.get('referer') || 'https://www.instagram.com/';

  if (!target) {
    res.statusCode = 400;
    res.end('Missing url query parameter');
    return;
  }

  await proxyUpstreamUrl(req, res, target, referer);
}

async function handleFreshDownload(req, res, reqUrl) {
  const postUrl = reqUrl.searchParams.get('postUrl');
  const indexParam = reqUrl.searchParams.get('index');
  const index = Number.isFinite(Number(indexParam)) ? Number(indexParam) : 0;

  if (!postUrl) {
    res.statusCode = 400;
    res.end('Missing postUrl query parameter');
    return;
  }

  try {
    const extracted = await instagramGetUrl(postUrl);
    const mediaList = Array.isArray(extracted?.media_details) ? extracted.media_details : [];
    const videoItems = mediaList.filter((item) => item?.type === 'video' && typeof item?.url === 'string');
    const fallbackUrls = Array.isArray(extracted?.url_list) ? extracted.url_list.filter((u) => typeof u === 'string') : [];

    const selectedVideo = videoItems[index] || videoItems[0];
    const selectedUrl = selectedVideo?.url || fallbackUrls[index] || fallbackUrls[0];

    if (!selectedUrl) {
      res.statusCode = 404;
      res.end('No downloadable media URL found for this post');
      return;
    }

    await proxyUpstreamUrl(req, res, selectedUrl, postUrl);
  } catch (error) {
    res.statusCode = 500;
    res.end(`Fresh download error: ${error?.message || 'unknown error'}`);
  }
}

async function handleYouTubeExtract(req, res, reqUrl) {
  const target = reqUrl.searchParams.get('url');

  if (!target) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing url query parameter' }));
    return;
  }

  if (!isYouTubeUrl(target)) {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'Host not allowed' }));
    return;
  }

  try {
    const info = await getYouTubeInfo(target);
    const { mp4Options, mp3Options } = pickYouTubeOptions(info);

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      provider: 'youtube',
      id: info.id || null,
      title: info.title || null,
      thumbnail: info.thumbnail || info?.thumbnails?.[0]?.url || null,
      duration: info.duration || null,
      mp4_options: mp4Options,
      mp3_options: mp3Options,
    }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: error?.message || 'YouTube extraction failed' }));
  }
}

async function handleYouTubeDownload(req, res, reqUrl) {
  const target = reqUrl.searchParams.get('url');
  const format = (reqUrl.searchParams.get('format') || 'mp4').toLowerCase();
  const requestedFormatId = (reqUrl.searchParams.get('formatId') || '').trim();

  if (!target) {
    res.statusCode = 400;
    res.end('Missing url query parameter');
    return;
  }

  if (!isYouTubeUrl(target)) {
    res.statusCode = 403;
    res.end('Host not allowed');
    return;
  }

  if (!['mp4', 'mp3'].includes(format)) {
    res.statusCode = 400;
    res.end('Unsupported format');
    return;
  }

  if (requestedFormatId && !/^[a-zA-Z0-9_.+-]+$/.test(requestedFormatId)) {
    res.statusCode = 400;
    res.end('Invalid formatId');
    return;
  }

  const tempRoot = path.join(os.tmpdir(), 'instasave-youtube');
  const tempDirectory = path.join(tempRoot, `${Date.now()}-${randomUUID()}`);
  await fsPromises.mkdir(tempDirectory, { recursive: true });

  try {
    const info = await getYouTubeInfo(target);
    const baseName = sanitizeFileSegment(info.title || info.id || 'youtube');
    const outputTemplate = path.join(tempDirectory, `${baseName}-${format}.%(ext)s`);

    const flags = {
      noPlaylist: true,
      noWarnings: true,
      noCallHome: true,
      ffmpegLocation: ffmpegPath || undefined,
      output: outputTemplate,
    };

    if (format === 'mp3') {
      flags.format = requestedFormatId || 'bestaudio/best';
      flags.extractAudio = true;
      flags.audioFormat = 'mp3';
      flags.audioQuality = '0';
    } else {
      flags.format = requestedFormatId ? `${requestedFormatId}+ba/b[ext=mp4]/b` : 'bv*+ba/b';
      flags.mergeOutputFormat = 'mp4';
    }

    await ytDlp.exec(target, flags, { cwd: tempDirectory });

    const files = await fsPromises.readdir(tempDirectory);
    const matchedFile = files
      .filter((fileName) => fileName.startsWith(`${baseName}-${format}.`))
      .sort()
      .pop() || files[0];

    if (!matchedFile) {
      throw new Error('YouTube download produced no file');
    }

    const filePath = path.join(tempDirectory, matchedFile);
    const fileInfo = await fsPromises.stat(filePath);

    res.statusCode = 200;
    res.setHeader('content-type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('content-length', String(fileInfo.size));
    res.setHeader('content-disposition', `attachment; filename="${matchedFile}"`);

    const fileStream = fs.createReadStream(filePath);
    const cleanup = () => cleanupDirectory(tempDirectory);
    res.on('close', cleanup);
    fileStream.on('error', () => {
      cleanup();
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end('Failed to stream YouTube file');
    });
    fileStream.pipe(res);
  } catch (error) {
    await cleanupDirectory(tempDirectory);
    res.statusCode = 500;
    res.end(`YouTube download error: ${error?.message || 'unknown error'}`);
  }
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (reqUrl.pathname === '/health') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (reqUrl.pathname === '/extract') {
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Missing url query parameter' }));
      return;
    }
    
    res.setHeader('content-type', 'application/json');
    try {
      const data = await instagramGetUrl(target);
      res.statusCode = 200;
      res.end(JSON.stringify(data));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message || 'Extraction failed' }));
    }
    return;
  }

  if (reqUrl.pathname === '/download') {
    await handleFreshDownload(req, res, reqUrl);
    return;
  }

  if (reqUrl.pathname === '/youtube/extract') {
    await handleYouTubeExtract(req, res, reqUrl);
    return;
  }

  if (reqUrl.pathname === '/youtube/download') {
    await handleYouTubeDownload(req, res, reqUrl);
    return;
  }

  if (reqUrl.pathname !== '/proxy') {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  await handleProxy(req, res, reqUrl);
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    console.error('Close the existing proxy process, then run npm run proxy again.');
    console.error('Windows helper: Get-NetTCPConnection -LocalPort 8787 -State Listen | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }');
    process.exit(1);
  }

  console.error('Proxy server startup failed:', error?.message || error);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`InstaSave proxy listening on http://0.0.0.0:${PORT}`);
  console.log('Health check: /health');
});
