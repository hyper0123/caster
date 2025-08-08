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
      console.error('ERROR:', message);
      if (errorDisplay) {
        errorDisplay.textContent = `ERROR: ${message}`;
        errorDisplay.style.display = 'block';
      }
      if (statusElement) statusElement.innerText = 'Error detectado';
      if (loadingOverlay) loadingOverlay.style.display = 'none';
    }

    // 1. Verificar que Cast Framework está cargado
    if (!window.cast || !window.cast.framework) {
      showError('Cast Framework no está cargado');
      return;
    }

    // 2. Verificar que Shaka Player está cargado
    if (!window.shaka) {
      showError('Shaka Player no está cargado');
      return;
    }

    // 3. Usar versión compatible de Shaka
    const shakaPlayer = new shaka.Player(videoElement);
    
    // Solución para setLevel
    if (shaka.log && shaka.log.setLevel) {
      shaka.log.setLevel(shaka.log.Level.DEBUG);
    } else {
      console.warn('shaka.log.setLevel no disponible');
    }

    // Configuración segura
    try {
      shakaPlayer.configure({
        streaming: {
          forceTransmuxTS: true,
          retryParameters: {
            maxAttempts: 5,
            baseDelay: 1000,
            backoffFactor: 2
          }
        }
      });
    } catch (configError) {
      showError(`Config Shaka: ${configError.message}`);
    }

    // Opciones del receptor
    const options = new cast.framework.CastReceiverOptions();
    options.disableIdleTimeout = true;
    options.maxInactivity = 3600;
    options.playbackConfig = new cast.framework.PlaybackConfig();

    // Usar versión de Shaka compatible con el framework
    options.useShakaForHls = true;
    options.shakaVersion = '4.7.10';  // Coincide con la versión cargada

    // Manejo de redirecciones simplificado
    shakaPlayer.getNetworkingEngine().registerResponseFilter(async (type, response) => {
      if (response.status >= 300 && response.status < 400 && response.headers['location']) {
        try {
          const newUrl = new URL(response.headers['location'], response.request.uris[0]).href;
          statusElement.innerText = `Redirigiendo a: ${newUrl}`;
          
          const newRequest = {
            ...response.request,
            uris: [newUrl]
          };
          
          return shakaPlayer.getNetworkingEngine().request(type, newRequest);
        } catch (error) {
          showError(`Redirección fallida: ${error.message}`);
        }
      }
      return response;
    });

    const fallbackURL = 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

    playerManager.setMessageInterceptor(
      cast.framework.messages.MessageType.LOAD,
      loadRequestData => {
        loadingOverlay.style.display = 'none';
        statusElement.innerText = 'Procesando contenido...';
        
        const media = loadRequestData.media;
        if (!media) {
          showError('Solicitud sin contenido');
          return new cast.framework.messages.ErrorData(
            cast.framework.messages.ErrorType.LOAD_FAILED
          );
        }
        
        if (media.customData) {
          const cd = media.customData;
          media.contentUrl = cd.url || cd.contentUrl || media.contentUrl;
          media.contentType = cd.contentType || media.contentType;
        }
        
        if (!media.contentUrl) {
          media.contentUrl = fallbackURL;
          media.contentType = 'video/mp4';
        }
        
        statusElement.innerText = `Cargando: ${media.contentUrl.substring(0, 50)}...`;
        return loadRequestData;
      }
    );

    playerManager.setMediaPlaybackInfoHandler((loadReq, playbackConfig) => {
      const cd = loadReq.media.customData || {};
      
      if (cd.licenseUrl) {
        playbackConfig.licenseUrl = cd.licenseUrl;
        playbackConfig.protectionSystem = 
          cd.licenseType === 'clearKey' 
            ? cast.framework.ContentProtection.CLEARKEY 
            : cast.framework.ContentProtection.WIDEVINE;
      }
      
      // Headers dinámicos
      const addHeaders = (req, headers) => {
        req.headers = {
          ...req.headers,
          ...headers,
          'User-Agent': 'Mozilla/5.0 (Chromecast)'
        };
      };
      
      if (cd.licenseHeaders) {
        playbackConfig.licenseRequestHandler = req => {
          addHeaders(req, cd.licenseHeaders);
          return req;
        };
      }
      
      if (cd.manifestHeaders) {
        playbackConfig.manifestRequestHandler = req => {
          addHeaders(req, cd.manifestHeaders);
        };
      }
      
      if (cd.segmentHeaders) {
        playbackConfig.segmentRequestHandler = req => {
          addHeaders(req, cd.segmentHeaders);
        };
      }
      
      return playbackConfig;
    });

    // Eventos de estado
    playerManager.addEventListener(
      cast.framework.events.EventType.MEDIA_STATUS,
      evt => {
        if (evt.mediaStatus.playerState === 'PLAYING') {
          statusElement.innerText = 'Reproduciendo';
          errorDisplay.style.display = 'none';
        }
      }
    );

    playerManager.addEventListener(
      cast.framework.events.EventType.ERROR,
      event => {
        showError(`Error del sistema: ${event.detailedError || event.error}`);
      }
    );

    // Iniciar receptor
    context.start(options);
    statusElement.innerText = 'Receptor listo';
    loadingOverlay.style.display = 'none';
    
    // Verificador de estado
    setTimeout(() => {
      if (loadingOverlay.style.display !== 'none') {
        showError('Tiempo de espera agotado');
      }
    }, 5000);
    
  } catch (globalError) {
    const errorElement = document.getElementById('errorDisplay') || document.createElement('div');
    errorElement.textContent = `FATAL: ${globalError.message}`;
    errorElement.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;padding:20px;z-index:1000;';
    document.body.appendChild(errorElement);
    console.error('Error global:', globalError);
  }
});
