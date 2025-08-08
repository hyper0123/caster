// Asegurarse de que el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', () => {
  try {
    const context = cast.framework.CastReceiverContext.getInstance();
    const playerManager = context.getPlayerManager();
    const videoElement = document.getElementById('video');
    const statusElement = document.getElementById('status');
    const errorDisplay = document.getElementById('errorDisplay');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Función para mostrar errores
    function showError(message) {
      console.error('ERROR VISIBLE:', message);
      if (errorDisplay) {
        errorDisplay.textContent = `ERROR: ${message}`;
        errorDisplay.style.display = 'block';
      }
      if (statusElement) statusElement.innerText = 'Error detectado';
      if (loadingOverlay) loadingOverlay.style.display = 'none';
    }

    function hideError() {
      if (errorDisplay) errorDisplay.style.display = 'none';
    }

    // Verificar compatibilidad básica
    if (!window.cast || !window.cast.framework) {
      showError('Error: Cast Framework no cargado');
      return;
    }

    if (!shaka || !shaka.Player) {
      showError('Error: Shaka Player no cargado');
      return;
    }

    statusElement.innerText = 'Verificando compatibilidad...';

    // Verificar compatibilidad con Shaka Player
    if (!shaka.Player.isBrowserSupported()) {
      showError('Shaka Player no compatible con este navegador');
      return;
    }

    // Opciones del receptor
    const options = new cast.framework.CastReceiverOptions();
    options.disableIdleTimeout = true;
    options.maxInactivity = 3600;
    options.useShakaForHls = true;
    options.shakaVersion = '4.15.9';
    options.playbackConfig = new cast.framework.PlaybackConfig();

    // Inicializar Shaka Player
    let shakaPlayer;
    try {
      shakaPlayer = new shaka.Player(videoElement);
      statusElement.innerText = 'Shaka Player inicializado';
    } catch (error) {
      showError(`Error al crear Shaka Player: ${error.message}`);
      return;
    }

    // Configuración de Shaka
    try {
      shaka.log.setLevel(shaka.log.Level.DEBUG);
      
      shakaPlayer.configure({
        streaming: {
          forceTransmuxTS: true,
          failureCallback: (error) => {
            showError(`Error transmuxing: ${error.message}`);
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
    } catch (error) {
      showError(`Error configurando Shaka: ${error.message}`);
      return;
    }

    // Manejo de errores de Shaka Player
    shakaPlayer.addEventListener('error', (event) => {
      const error = event.detail;
      showError(`Shaka Error ${error.code}: ${error.message}`);
    });

    // Manejo de redirecciones
    shakaPlayer.getNetworkingEngine().registerResponseFilter(async (type, response) => {
      if (response.status >= 300 && response.status < 400 && response.headers['location']) {
        try {
          const newUrl = new URL(response.headers['location'], response.request.uris[0]).href;
          statusElement.innerText = `Redirigiendo a: ${newUrl}`;
          
          const newRequest = {
            ...response.request,
            uris: [newUrl],
            headers: { ...response.request.headers }
          };
          
          delete newRequest.headers['range'];
          
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

    // Interceptar LOAD
    playerManager.setMessageInterceptor(
      cast.framework.messages.MessageType.LOAD,
      loadRequestData => {
        hideError();
        statusElement.innerText = 'Procesando solicitud...';
        
        if (!loadRequestData.media) {
          showError('Media no definida en la solicitud');
          return new cast.framework.messages.ErrorData(
            cast.framework.messages.ErrorType.LOAD_FAILED
          );
        }
        
        const media = loadRequestData.media;
        
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

    // Configurar DRM y headers
    playerManager.setMediaPlaybackInfoHandler((loadReq, playbackConfig) => {
      const cd = loadReq.media.customData || {};
      
      if (cd.licenseUrl) {
        playbackConfig.licenseUrl = cd.licenseUrl;
        playbackConfig.protectionSystem = 
          cd.licenseType === 'clearKey' 
            ? cast.framework.ContentProtection.CLEARKEY 
            : cast.framework.ContentProtection.WIDEVINE;
      }
      
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
        if (loadingOverlay) loadingOverlay.style.display = 'none';
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

    // Iniciar receptor
    try {
      context.start(options);
      statusElement.innerText = 'Receptor listo. Esperando contenido...';
      if (loadingOverlay) loadingOverlay.style.display = 'none';
    } catch (error) {
      showError(`Error al iniciar receptor: ${error.message}`);
    }

    // Verificar si todo está listo después de 5 segundos
    setTimeout(() => {
      if (loadingOverlay && loadingOverlay.style.display !== 'none') {
        showError('El receptor no se inició correctamente');
      }
    }, 5000);
    
  } catch (error) {
    const errorDisplay = document.getElementById('errorDisplay');
    if (errorDisplay) {
      errorDisplay.textContent = `ERROR FATAL: ${error.message}`;
      errorDisplay.style.display = 'block';
    }
    console.error('Error fatal en receptor:', error);
  }
});
