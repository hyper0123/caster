const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();
const videoElement = document.getElementById('video');
const statusElement = document.getElementById('status');
const errorDisplay = document.getElementById('errorDisplay');

// Opciones del receptor
const options = new cast.framework.CastReceiverOptions();
options.disableIdleTimeout = true;
options.maxInactivity = 3600;
options.useShakaForHls = true;
options.shakaVersion = '4.15.9';
options.playbackConfig = new cast.framework.PlaybackConfig();

// Inicializa Shaka Player
const shakaPlayer = new shaka.Player(videoElement);

// Habilitar logs detallados
shaka.log.setLevel(shaka.log.Level.DEBUG);

// Configuración de Shaka
shakaPlayer.configure({
  streaming: {
    forceTransmuxTS: true,  // Necesario para HLS con TS
    failureCallback: (error) => {
      showError(`Error de transmuxing: ${error.message}`);
    },
    retryParameters: {
      maxAttempts: 5,
      baseDelay: 1000,
      backoffFactor: 2,
      fuzzFactor: 0.5
    }
  },
  manifest: {
    dash: { ignoreMinBufferTime: true },
    retryParameters: { maxAttempts: 5 }
  }
});

// Función para mostrar errores en pantalla
function showError(message) {
  console.error('ERROR VISIBLE:', message);
  errorDisplay.textContent = `ERROR: ${message}`;
  errorDisplay.style.display = 'block';
  statusElement.innerText = 'Error detectado';
  
  // Ocultar después de 15 segundos
  setTimeout(() => {
    errorDisplay.classList.add('error-hidden');
  }, 15000);
}

function hideError() {
  errorDisplay.style.display = 'none';
  errorDisplay.classList.add('error-hidden');
}

// Manejo de errores de Shaka Player
shakaPlayer.addEventListener('error', (event) => {
  const error = event.detail;
  const errorMap = {
    1000: 'RECURSO_NO_ENCONTRADO',
    1001: 'TIEMPO_ESPERA_AGOTADO',
    1002: 'SOLICITUD_ABORTADA',
    1003: 'ERROR_DE_RED',
    1004: 'ERROR_DE_PARSEO',
    1005: 'ERROR_DE_DECODIFICACION',
    1006: 'CIFRADO_NO_SOPORTADO',
    1007: 'MANIFEST_INVALIDO',
    1008: 'ERROR_STREAMING',
    1009: 'VARIANTE_INVALIDA',
    1010: 'TRANSFORMACION_CONTENIDO',
    1011: 'OPERACION_ABORTADA',
    1012: 'ERROR_HISTORIAL',
    1013: 'ERROR_INDEXED_DB',
    1014: 'DESBORDAMIENTO_BUFFER',
    1015: 'ERROR_VIDEO',
    1016: 'FORMATO_NO_SOPORTADO',
    1017: 'DRM_NO_SOPORTADO',
    1018: 'FALLO_SOLICITUD_LICENCIA',
    1020: 'CERTIFICADO_SERVIDOR_REQUERIDO',
    1021: 'FALLO_SOLICITUD_CERTIFICADO',
    1022: 'RESPUESTA_LICENCIA_RECHAZADA'
  };
  
  const errorName = errorMap[error.code] || `ERROR_DESCONOCIDO (${error.code})`;
  const errorMessage = `Shaka Error [${errorName}]: ${error.message}`;
  showError(errorMessage);
});

// Manejo de redirecciones recursivas
shakaPlayer.getNetworkingEngine().registerResponseFilter(async (type, response) => {
  if (response.status >= 300 && response.status < 400 && response.headers['location']) {
    const newUrl = new URL(response.headers['location'], response.request.uris[0]).href;
    statusElement.innerText = `Redirigiendo a: ${newUrl}`;
    
    const newRequest = {
      ...response.request,
      uris: [newUrl],
      headers: { ...response.request.headers }
    };
    
    // Algunos servidores rechazan Range en redirecciones
    delete newRequest.headers['range'];
    
    try {
      const newResponse = await shakaPlayer.getNetworkingEngine().request(type, newRequest);
      return newResponse;
    } catch (error) {
      showError(`Error en redirección: ${error.message}`);
      throw error;
    }
  }
  return response;
});

const fallbackURL = 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

// Interceptar LOAD para customData y fallback
playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  loadRequestData => {
    hideError();
    statusElement.innerText = 'Procesando solicitud...';
    
    const media = loadRequestData.media;
    if (!media) {
      showError('Media no definida en la solicitud');
      return new cast.framework.messages.ErrorData(
        cast.framework.messages.ErrorType.LOAD_FAILED
      );
    }
    
    // Manejo de customData
    if (media.customData) {
      const cd = media.customData;
      if (cd.url) media.contentUrl = cd.url;
      else if (cd.contentUrl) media.contentUrl = cd.contentUrl;
      if (cd.contentType) media.contentType = cd.contentType;
    }
    
    // Fallback si falta URL
    if (!media.contentUrl) {
      media.contentUrl = fallbackURL;
      media.contentType = 'video/mp4';
      statusElement.innerText = 'Usando contenido por defecto';
    }
    
    // Verificar compatibilidad
    if (media.contentType === 'application/x-mpegURL' && 
        !shaka.Player.isTypeSupported('application/vnd.apple.mpegurl')) {
      showError('HLS no soportado en este dispositivo');
    }
    
    statusElement.innerText = `Cargando: ${media.contentUrl.substring(0, 50)}...`;
    return loadRequestData;
  }
);

// Configurar DRM y headers según customData
playerManager.setMediaPlaybackInfoHandler((loadReq, playbackConfig) => {
  const cd = loadReq.media.customData || {};
  
  // Configuración de DRM
  if (cd.licenseUrl) {
    playbackConfig.licenseUrl = cd.licenseUrl;
    playbackConfig.protectionSystem = 
      cd.licenseType === 'clearKey' 
        ? cast.framework.ContentProtection.CLEARKEY 
        : cast.framework.ContentProtection.WIDEVINE;
  }
  
  // Configuración de headers
  const setRequestHandler = (handlerType, headers) => {
    playbackConfig[`${handlerType}RequestHandler`] = req => {
      req.headers = {
        ...req.headers,
        ...headers,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36'
      };
    };
  };
  
  if (cd.licenseHeaders) setRequestHandler('license', cd.licenseHeaders);
  if (cd.manifestHeaders) setRequestHandler('manifest', cd.manifestHeaders);
  if (cd.segmentHeaders) setRequestHandler('segment', cd.segmentHeaders);
  
  return playbackConfig;
});

// Estado en pantalla
playerManager.addEventListener(
  cast.framework.events.EventType.MEDIA_STATUS,
  evt => {
    if (evt.mediaStatus.playerState === 'PLAYING') {
      statusElement.innerText = 'Reproduciendo';
      hideError();
    } else if (evt.mediaStatus.playerState === 'BUFFERING') {
      statusElement.innerText = 'Buffering...';
    }
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.ERROR,
  event => {
    const error = event.error || event.detailedError || 'Error desconocido';
    showError(`Error del receptor: ${error}`);
  }
);

// Inicia receptor
context.start(options);
statusElement.innerText = 'Receptor listo';

// Verificar compatibilidad inicial
if (!shaka.Player.isBrowserSupported()) {
  showError('Shaka Player no es compatible con este navegador');
}
