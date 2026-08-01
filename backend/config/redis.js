import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let pubClient = null;
let subClient = null;
let redisCacheClient = null;
let isRedisConnected = false;

// Memory cache fallback for when Redis is unavailable
const memoryStore = new Map();

export const initRedis = () => {
  if (pubClient) return { pubClient, subClient, redisCacheClient, isRedisConnected };

  try {
    const options = {
      retryStrategy(times) {
        if (times > 5) {
          console.warn('⚠️ Redis server unreachable. Falling back to in-memory caching and local socket adapter.');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: true
    };

    pubClient = new Redis(redisUrl, options);
    subClient = pubClient.duplicate();
    redisCacheClient = pubClient.duplicate();

    pubClient.on('connect', () => {
      isRedisConnected = true;
      console.log('✅ Redis client connected successfully');
    });

    pubClient.on('error', () => {
      isRedisConnected = false;
    });

    pubClient.connect().catch(() => {});
    subClient.connect().catch(() => {});
    redisCacheClient.connect().catch(() => {});

  } catch (error) {
    console.warn('⚠️ Failed to initialize Redis connection:', error.message);
  }

  return { pubClient, subClient, redisCacheClient, isRedisConnected };
};

export const cacheSet = async (key, value, ttlSeconds = 60) => {
  try {
    if (isRedisConnected && redisCacheClient?.status === 'ready') {
      await redisCacheClient.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      return;
    }
  } catch (err) {}

  memoryStore.set(key, {
    data: value,
    expiry: Date.now() + ttlSeconds * 1000
  });
};

export const cacheGet = async (key) => {
  try {
    if (isRedisConnected && redisCacheClient?.status === 'ready') {
      const data = await redisCacheClient.get(key);
      if (data) return JSON.parse(data);
    }
  } catch (err) {}

  const item = memoryStore.get(key);
  if (!item) return null;

  if (Date.now() > item.expiry) {
    memoryStore.delete(key);
    return null;
  }

  return item.data;
};

export const cacheDel = async (patternOrKey) => {
  try {
    if (isRedisConnected && redisCacheClient?.status === 'ready') {
      if (patternOrKey.includes('*')) {
        const keys = await redisCacheClient.keys(patternOrKey);
        if (keys.length > 0) {
          await redisCacheClient.del(...keys);
        }
      } else {
        await redisCacheClient.del(patternOrKey);
      }
    }
  } catch (err) {}

  for (const key of memoryStore.keys()) {
    if (key.includes(patternOrKey.replace('*', ''))) {
      memoryStore.delete(key);
    }
  }
};

export const getRedisStatus = () => {
  return {
    connected: isRedisConnected,
    mode: isRedisConnected ? 'redis' : 'memory_fallback',
    memoryKeysCount: memoryStore.size
  };
};
