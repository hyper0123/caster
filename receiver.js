const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();
const options = new cast.framework.CastReceiverOptions();
// Opciones generales
options.disableIdleTimeout = true;
options.maxInactivity = 3600;
// Habilitar Shaka para HLS (opcional)
options.useShakaForHls = true;
options.shakaVersion = '4.15.9';
options.playbackConfig = new cast.framework.PlaybackConfig();

// Video de demostración de respaldo
const fallbackURL = 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

// Interceptar LOAD para usar customData y fallback
playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD, (loadRequestData) => {
    const media = loadRequestData.media;
    if (!media) {
      const error = new cast.framework.messages.ErrorData(
        cast.framework.messages.ErrorType.LOAD_FAILED
      );
      error.reason = cast.framework.messages.ErrorReason.INVALID_PARAM;
      return error;
    }
    if (media.customData) {
      const cd = media.customData;
      // Asignar URL y tipo desde customData (por ejemplo 'url' o 'contentUrl')
      if (cd.url) media.contentUrl = cd.url;
      else if (cd.contentUrl) media.contentUrl = cd.contentUrl;
      if (cd.contentType) media.contentType = cd.contentType;
    }
    // Lógica de fallback: si no hay URL válida, usar video de demostración
    if (!media.contentUrl) {
      media.contentUrl = fallbackURL;
      media.contentType = 'video/mp4';
    }
    document.getElementById('status').innerText = 'Video recibido';
    return loadRequestData;
  }
);

// Configurar DRM y cabeceras adicionales según customData
playerManager.setMediaPlaybackInfoHandler((loadRequestData, playbackConfig) => {
  const cd = loadRequestData.media.customData;
  if (cd) {
    if (cd.licenseUrl) {
      playbackConfig.licenseUrl = cd.licenseUrl;
      // Determinar tipo de DRM: Widevine o ClearKey
      playbackConfig.protectionSystem = (
        cd.licenseType === 'clearKey' ?
        cast.framework.ContentProtection.CLEARKEY :
        cast.framework.ContentProtection.WIDEVINE
      );
    }
    if (cd.licenseHeaders) {
      playbackConfig.licenseRequestHandler = (requestInfo) => {
        requestInfo.headers = cd.licenseHeaders;
        return requestInfo;
      };
    }
    if (cd.manifestHeaders) {
      playbackConfig.manifestRequestHandler = (requestInfo) => {
        requestInfo.headers = cd.manifestHeaders;
      };
    }
    if (cd.segmentHeaders) {
      playbackConfig.segmentRequestHandler = (requestInfo) => {
        requestInfo.headers = cd.segmentHeaders;
      };
    }
  }
  return playbackConfig;
});

// Mostrar estados en pantalla
playerManager.addEventListener(
  cast.framework.events.EventType.MEDIA_STATUS, (event) => {
    const state = event.mediaStatus.playerState;
    if (state === 'PLAYING') {
      document.getElementById('status').innerText = 'Reproduciendo';
    }
  }
);
playerManager.addEventListener(
  cast.framework.events.EventType.ERROR, (event) => {
    document.getElementById('status').innerText = 'Error de carga';
  }
);

// Iniciar el contexto con las opciones configuradas
context.start(options);
