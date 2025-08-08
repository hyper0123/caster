document.addEventListener('DOMContentLoaded', function() {
  // Elementos DOM
  const videoElement = document.getElementById('video');
  const statusElement = document.getElementById('status');
  const errorDisplay = document.getElementById('errorDisplay');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingSpinner = document.getElementById('loadingSpinner');
  
  // Función para mostrar errores
  function showError(message) {
    console.error('ERROR:', message);
    if (errorDisplay) {
      errorDisplay.textContent = `ERROR: ${message}`;
      errorDisplay.style.display = 'block';
    }
    if (statusElement) statusElement.innerText = 'Error detectado';
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (loadingSpinner) loadingSpinner.style.display = 'none';
  }

  // 1. Verificar que los frameworks están cargados
  if (!window.cast || !window.cast.framework) {
    showError('Cast Framework no está cargado');
    return;
  }

  if (!window.shaka) {
    showError('Shaka Player no está cargado');
    return;
  }

  try {
    const context = cast.framework.CastReceiverContext.getInstance();
    const playerManager = context.getPlayerManager();
    
    // 2. Crear instancia de Shaka Player
    let shakaPlayer;
    try {
      shakaPlayer = new shaka.Player(videoElement);
      statusElement.innerText = 'Shaka Player inicializado';
    } catch (playerError) {
      showError(`Error al crear Shaka Player: ${playerError.message}`);
      return;
    }

    // 3. Configuración segura de Shaka
    try {
      // Verificar si las funciones de configuración existen
      if (shakaPlayer && shakaPlayer.configure) {
        // Configuración mínima y segura
        shakaPlayer.configure({
          streaming: {
            retryParameters: {
              maxAttempts: 3,
              baseDelay: 1000,
              backoffFactor: 2
            }
          }
        });
        statusElement.innerText = 'Shaka configurado correctamente';
      } else {
        showError('Shaka Player no tiene método configure');
        return;
      }
    } catch (configError) {
      showError(`Error configurando Shaka: ${configError.message}`);
      return;
    }

    // 4. Opciones del receptor
    const options = new cast.framework.CastReceiverOptions();
    options.disableIdleTimeout = true;
    options.maxInactivity = 3600;
    options.playbackConfig = new cast.framework.PlaybackConfig();
    options.useShakaForHls = true;
    options.shakaVersion = '4.7.10';

    // 5. Manejo de redirecciones (solo si está disponible)
    if (shakaPlayer.getNetworkingEngine && shakaPlayer.getNetworkingEngine().registerResponseFilter) {
      shakaPlayer.getNetworkingEngine().registerResponseFilter(function(type, response) {
        if (response.status >= 300 && response.status < 400 && response.headers['location']) {
          try {
            const newUrl = new URL(response.headers['location'], response.request.uris[0]).href;
            statusElement.innerText = `Redirigiendo a: ${newUrl}`;
            
            return shakaPlayer.getNetworkingEngine().request(
              type, 
              Object.assign({}, response.request, {uris: [newUrl]})
            );
          } catch (error) {
            showError(`Redirección fallida: ${error.message}`);
          }
        }
        return response;
      });
    }

    // 6. URL de fallback
    const fallbackURL = 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

    // 7. Interceptor de carga
    playerManager.setMessageInterceptor(
      cast.framework.messages.MessageType.LOAD,
      loadRequestData => {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        if (statusElement) statusElement.innerText = 'Procesando contenido...';
        
        if (!loadRequestData.media) {
          showError('Solicitud sin contenido');
          return new cast.framework.messages.ErrorData(
            cast.framework.messages.ErrorType.LOAD_FAILED
          );
        }
        
        const media = loadRequestData.media;
        
        // Manejar customData
        if (media.customData) {
          const cd = media.customData;
          media.contentUrl = cd.url || cd.contentUrl || media.contentUrl;
          media.contentType = cd.contentType || media.contentType;
        }
        
        // Usar fallback si es necesario
        if (!media.contentUrl) {
          media.contentUrl = fallbackURL;
          media.contentType = 'video/mp4';
          statusElement.innerText = 'Usando contenido por defecto';
        }
        
        if (statusElement) {
          statusElement.innerText = `Cargando: ${media.contentUrl.substring(0, 50)}...`;
        }
        
        return loadRequestData;
      }
    );

    // 8. Configuración de DRM y headers
    playerManager.setMediaPlaybackInfoHandler((loadReq, playbackConfig) => {
      const cd = loadReq.media.customData || {};
      
      if (cd.licenseUrl) {
        playbackConfig.licenseUrl = cd.licenseUrl;
        playbackConfig.protectionSystem = 
          cd.licenseType === 'clearKey' 
            ? cast.framework.ContentProtection.CLEARKEY 
            : cast.framework.ContentProtection.WIDEVINE;
      }
      
      // Función para añadir headers
      const addHeaders = (req, headers) => {
        req.headers = Object.assign({}, req.headers, headers, {
          'User-Agent': 'Mozilla/5.0 (Chromecast)'
        });
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

    // 9. Eventos de estado
    playerManager.addEventListener(
      cast.framework.events.EventType.MEDIA_STATUS,
      evt => {
        if (evt.mediaStatus.playerState === 'PLAYING') {
          if (statusElement) statusElement.innerText = 'Reproduciendo';
          if (errorDisplay) errorDisplay.style.display = 'none';
        } else if (evt.mediaStatus.playerState === 'BUFFERING') {
          if (statusElement) statusElement.innerText = 'Buffering...';
        }
      }
    );

    playerManager.addEventListener(
      cast.framework.events.EventType.ERROR,
      event => {
        const errorMsg = event.detailedError || event.error || 'Error desconocido';
        showError(`Error del sistema: ${errorMsg}`);
      }
    );

    // 10. Iniciar el receptor
    try {
      context.start(options);
      if (statusElement) statusElement.innerText = 'Receptor listo. Esperando contenido...';
      if (loadingOverlay) loadingOverlay.style.display = 'none';
    } catch (startError) {
      showError(`Error al iniciar receptor: ${startError.message}`);
    }

    // 11. Timeout de seguridad
    setTimeout(() => {
      if (loadingOverlay && loadingOverlay.style.display !== 'none') {
        showError('Tiempo de espera agotado - Receptor no iniciado');
      }
    }, 8000);
    
  } catch (globalError) {
    showError(`Error global: ${globalError.message}`);
    console.error('Error en receptor:', globalError);
  }
});
