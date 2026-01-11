const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

const options = new cast.framework.CastReceiverOptions();
options.disableIdleTimeout = true;

// ✅ Para HLS
options.useShakaForHls = true;
options.shakaVersion = '4.9.2';

// ✅ PlaybackConfig
options.playbackConfig = new cast.framework.PlaybackConfig();


// PlaybackConfig para requests (manifest/segment/license)
const playbackConfig = new cast.framework.PlaybackConfig();

/**
 * helper: aplica headers “permitidos” desde customData
 * OJO: User-Agent/Referer suelen ser forbidden en runtime web.
 */
function applyHeadersFromCustomData(requestInfo, cdHeaders) {
  if (!cdHeaders) return requestInfo;

  requestInfo.headers = requestInfo.headers || {};

  for (const [k, v] of Object.entries(cdHeaders)) {
    if (!v) continue;

    // Evitar setear headers típicamente forbidden (mejor no arriesgar)
    const key = String(k).toLowerCase();
    if (key === "user-agent" || key === "referer") continue;

    requestInfo.headers[k] = v;
  }
  return requestInfo;
}

playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    const media = loadRequestData.media;
    if (!media) {
      const err = new cast.framework.messages.ErrorData(
        cast.framework.messages.ErrorType.LOAD_FAILED
      );
      err.reason = cast.framework.messages.ErrorReason.INVALID_PARAM;
      return err;
    }

    const cd = media.customData || {};
    if (cd.url) media.contentUrl = cd.url;
    if (cd.contentType) media.contentType = cd.contentType;

    document.getElementById("status").innerText =
      `LOAD: ${media.contentUrl || "sin url"}`;

    return loadRequestData;
  }
);

playerManager.setMediaPlaybackInfoHandler((loadRequestData, cfg) => {
  const cd = (loadRequestData.media && loadRequestData.media.customData) || {};

  // headers por tipo
  const manifestHeaders = cd.manifestHeaders || cd.headers || null;
  const segmentHeaders  = cd.segmentHeaders  || cd.headers || null;
  const licenseHeaders  = cd.licenseHeaders  || cd.headers || null;

  cfg.manifestRequestHandler = (requestInfo) => applyHeadersFromCustomData(requestInfo, manifestHeaders);
  cfg.segmentRequestHandler  = (requestInfo) => applyHeadersFromCustomData(requestInfo, segmentHeaders);
  cfg.licenseRequestHandler  = (requestInfo) => applyHeadersFromCustomData(requestInfo, licenseHeaders);

  // DRM opcional (si algún día lo usás)
  if (cd.licenseUrl) {
    cfg.licenseUrl = cd.licenseUrl;
    cfg.protectionSystem =
      cd.licenseType === "clearKey"
        ? cast.framework.ContentProtection.CLEARKEY
        : cast.framework.ContentProtection.WIDEVINE;
  }

  return cfg;
});

playerManager.addEventListener(
  cast.framework.events.EventType.MEDIA_STATUS,
  (event) => {
    const state = event.mediaStatus && event.mediaStatus.playerState;
    if (state) document.getElementById("status").innerText = `Estado: ${state}`;
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.ERROR,
  () => (document.getElementById("status").innerText = "Error")
);

options.playbackConfig = playbackConfig;
context.start(options);

