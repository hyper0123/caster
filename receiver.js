const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

const options = new cast.framework.CastReceiverOptions();
options.disableIdleTimeout = true;
options.useShakaForHls = true;
// 👉 probá SIN fijar shakaVersion al inicio (a veces rompe si no coincide)
// options.shakaVersion = '4.9.2';

const playbackConfig = new cast.framework.PlaybackConfig();

function applyHeadersFromCustomData(requestInfo, cdHeaders) {
  if (!cdHeaders) return requestInfo;
  requestInfo.headers = requestInfo.headers || {};

  for (const [k, v] of Object.entries(cdHeaders)) {
    if (!v) continue;
    const key = String(k).toLowerCase();
    // Forbidden headers en entorno web
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
    const url = cd.url || cd.contentUrl;

    if (url) {
      media.contentId = url;     // ✅ estándar
      media.contentUrl = url;    // ✅ compat
    }
    if (cd.contentType) media.contentType = cd.contentType;

    console.log("LOAD url=", url, "type=", media.contentType, "cd=", cd);
    const s = document.getElementById("status");
    if (s) s.innerText = `LOAD: ${url || "sin url"}`;

    return loadRequestData;
  }
);

playerManager.setMediaPlaybackInfoHandler((loadRequestData, cfg) => {
  const cd = (loadRequestData.media && loadRequestData.media.customData) || {};
  const h = cd.headers || null;

  const manifestHeaders = cd.manifestHeaders || h;
  const segmentHeaders  = cd.segmentHeaders  || h;
  const licenseHeaders  = cd.licenseHeaders  || h;

  cfg.manifestRequestHandler = (ri) => applyHeadersFromCustomData(ri, manifestHeaders);
  cfg.segmentRequestHandler  = (ri) => applyHeadersFromCustomData(ri, segmentHeaders);
  cfg.licenseRequestHandler  = (ri) => applyHeadersFromCustomData(ri, licenseHeaders);

  if (cd.licenseUrl) {
    cfg.licenseUrl = cd.licenseUrl;
    cfg.protectionSystem =
      cd.licenseType === "clearKey"
        ? cast.framework.ContentProtection.CLEARKEY
        : cast.framework.ContentProtection.WIDEVINE;
  }

  return cfg;
});

playerManager.addEventListener(cast.framework.events.EventType.ERROR, (e) => {
  console.log("PLAYER ERROR:", e);
  const s = document.getElementById("status");
  if (s) s.innerText = "Error (ver consola)";
});

playerManager.addEventListener(
  cast.framework.events.EventType.MEDIA_STATUS,
  (event) => {
    const st = event.mediaStatus;
    const state = st && st.playerState;
    console.log("MEDIA_STATUS:", st);
    const s = document.getElementById("status");
    if (s && state) s.innerText = `Estado: ${state}`;
  }
);

options.playbackConfig = playbackConfig;
context.start(options);

