import os from 'os';

const metrics = {
  totalRequests: 0,
  activeRequests: 0,
  statusCodes: {},
  totalResponseTimeMs: 0,
  averageResponseTimeMs: 0,
  startTime: Date.now()
};

export const requestMetricsMiddleware = (req, res, next) => {
  metrics.totalRequests += 1;
  metrics.activeRequests += 1;
  const start = process.hrtime();

  res.on('finish', () => {
    metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
    
    const [seconds, nanoseconds] = process.hrtime(start);
    const durationMs = seconds * 1000 + nanoseconds / 1e6;

    metrics.totalResponseTimeMs += durationMs;
    metrics.averageResponseTimeMs = Math.round(
      (metrics.totalResponseTimeMs / metrics.totalRequests) * 100
    ) / 100;

    const statusCode = res.statusCode;
    metrics.statusCodes[statusCode] = (metrics.statusCodes[statusCode] || 0) + 1;
  });

  next();
};

export const getSystemMetrics = (io) => {
  const memUsage = process.memoryUsage();
  const freeMemBytes = os.freemem();
  const totalMemBytes = os.totalmem();
  const cpuLoad = os.loadavg();

  return {
    uptimeSeconds: Math.floor((Date.now() - metrics.startTime) / 1000),
    requests: {
      total: metrics.totalRequests,
      active: metrics.activeRequests,
      averageLatencyMs: metrics.averageResponseTimeMs,
      statusCodes: metrics.statusCodes
    },
    system: {
      platform: process.platform,
      arch: os.arch(),
      cpusCount: os.cpus().length,
      loadAverage: cpuLoad,
      memory: {
        totalMb: Math.round(totalMemBytes / (1024 * 1024)),
        freeMb: Math.round(freeMemBytes / (1024 * 1024)),
        rssMb: Math.round(memUsage.rss / (1024 * 1024)),
        heapTotalMb: Math.round(memUsage.heapTotal / (1024 * 1024)),
        heapUsedMb: Math.round(memUsage.heapUsed / (1024 * 1024))
      }
    },
    sockets: {
      activeConnections: io?.engine?.clientsCount || 0
    }
  };
};
