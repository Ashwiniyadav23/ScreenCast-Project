import http from 'http';
import { URL } from 'url';

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:5000/api/health';
const CONCURRENCY_LEVELS = [50, 100, 250, 500];
const REQUESTS_PER_USER = 10;

console.log('🚀 Starting ScreenCast Pro Performance & Concurrency Load Test...\n');

async function makeRequest(url) {
  const start = Date.now();
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ScreenCast-LoadTester/1.0'
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - start;
        resolve({ success: res.statusCode === 200, statusCode: res.statusCode, duration });
      });
    });

    req.on('error', (err) => {
      const duration = Date.now() - start;
      resolve({ success: false, error: err.message, duration });
    });

    req.on('timeout', () => {
      req.destroy();
      const duration = Date.now() - start;
      resolve({ success: false, error: 'TIMEOUT', duration });
    });

    req.end();
  });
}

async function runBenchmarkForConcurrency(concurrency) {
  const totalRequests = concurrency * REQUESTS_PER_USER;
  console.log(`📊 Benchmark: ${concurrency} Concurrent Users (${totalRequests} Total Requests)...`);
  
  const startTime = Date.now();
  const results = [];

  // Batch execution across concurrent virtual user workers
  const userPromises = Array.from({ length: concurrency }).map(async () => {
    for (let i = 0; i < REQUESTS_PER_USER; i++) {
      const result = await makeRequest(TARGET_URL);
      results.push(result);
    }
  });

  await Promise.all(userPromises);
  const totalTimeMs = Date.now() - startTime;

  const successful = results.filter(r => r.success).length;
  const failed = results.length - successful;
  const durations = results.map(r => r.duration).sort((a, b) => a - b);
  
  const sumDuration = durations.reduce((a, b) => a + b, 0);
  const avgDuration = Math.round(sumDuration / durations.length);
  const p50 = durations[Math.floor(durations.length * 0.50)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const p99 = durations[Math.floor(durations.length * 0.99)];
  const requestsPerSec = Math.round((results.length / (totalTimeMs / 1000)));

  console.log(`  ├─ Total Time: ${totalTimeMs} ms`);
  console.log(`  ├─ Successful Requests: ${successful} / ${totalRequests} (${((successful / totalRequests) * 100).toFixed(1)}%)`);
  console.log(`  ├─ Failed Requests: ${failed}`);
  console.log(`  ├─ Throughput: ${requestsPerSec} req/sec`);
  console.log(`  ├─ Avg Latency: ${avgDuration} ms`);
  console.log(`  ├─ Latency P50: ${p50} ms`);
  console.log(`  ├─ Latency P95: ${p95} ms`);
  console.log(`  └─ Latency P99: ${p99} ms\n`);

  return { concurrency, totalRequests, successful, failed, requestsPerSec, avgDuration, p50, p95, p99 };
}

async function main() {
  const summary = [];
  for (const concurrency of CONCURRENCY_LEVELS) {
    const res = await runBenchmarkForConcurrency(concurrency);
    summary.push(res);
  }

  console.log('====================================================');
  console.log('🎉 LOAD TEST SUMMARY REPORT');
  console.log('====================================================');
  console.table(summary.map(s => ({
    'Concurrent Users': s.concurrency,
    'Req/Sec (Throughput)': s.requestsPerSec,
    'Avg Latency (ms)': s.avgDuration,
    'P95 Latency (ms)': s.p95,
    'Success Rate': `${((s.successful / s.totalRequests) * 100).toFixed(1)}%`
  })));
}

main().catch(console.error);
