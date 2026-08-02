/**
 * Configuración de pm2 para el servidor.
 *
 * `fork` y una sola instancia a propósito: el proceso mantiene un pool de
 * conexiones a Postgres y una cola de descarga de imágenes que no está pensada
 * para repartirse entre varios workers. Con 4 núcleos compartidos con la base
 * y con nginx, clonar el proceso solo añadiría contención.
 */
module.exports = {
  apps: [
    {
      name: 'api-inmobiliaria',
      script: 'dist/main.js',
      cwd: '/var/www/api-inmobiliaria.nordikhat.com',
      instances: 1,
      exec_mode: 'fork',
      // El .env vive fuera del repositorio y lo lee la propia aplicación.
      env: { NODE_ENV: 'production' },
      max_memory_restart: '900M',
      // sharp reserva memoria fuera del heap de V8; sin este margen el proceso
      // muere procesando fotos grandes.
      node_args: '--max-old-space-size=768',
      error_file: '/var/log/api-inmobiliaria.error.log',
      out_file: '/var/log/api-inmobiliaria.log',
      merge_logs: true,
      time: true,
      autorestart: true,
      // Un fallo al arrancar suele ser configuración: reintentar en bucle
      // solo llena el log.
      max_restarts: 10,
      restart_delay: 4000,
    },
  ],
};
