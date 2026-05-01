#!/usr/bin/env node

/**
 * Manual test script for the GET /pools/:id/ticks endpoint
 * 
 * Usage:
 *   node test-ticks-endpoint.js [base_url] [pool_id]
 * 
 * Examples:
 *   node test-ticks-endpoint.js http://localhost:3000 clx1234567890123456789012
 *   node test-ticks-endpoint.js https://api.swyft.dev 0x1234567890123456789012345678901234567890
 */

const https = require('https');
const http = require('http');

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const POOL_ID = process.argv[3] || 'clx1234567890123456789012';

async function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const startTime = Date.now();
    
    client.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          responseTime,
        });
      });
    }).on('error', reject);
  });
}

async function testTicksEndpoint() {
  console.log('🧪 Testing GET /pools/:id/ticks endpoint');
  console.log(`📍 Base URL: ${BASE_URL}`);
  console.log(`🏊 Pool ID: ${POOL_ID}`);
  console.log('');

  const tests = [
    {
      name: 'Get all ticks for pool',
      url: `${BASE_URL}/pools/${POOL_ID}/ticks`,
    },
    {
      name: 'Get ticks with range filter',
      url: `${BASE_URL}/pools/${POOL_ID}/ticks?lowerTick=-276330&upperTick=-276320`,
    },
    {
      name: 'Get ticks with only lowerTick',
      url: `${BASE_URL}/pools/${POOL_ID}/ticks?lowerTick=-276325`,
    },
    {
      name: 'Get ticks with only upperTick',
      url: `${BASE_URL}/pools/${POOL_ID}/ticks?upperTick=-276320`,
    },
    {
      name: 'Test unknown pool (should return 404)',
      url: `${BASE_URL}/pools/unknown_pool_id/ticks`,
    },
    {
      name: 'Test invalid tick range (should return 400)',
      url: `${BASE_URL}/pools/${POOL_ID}/ticks?lowerTick=-276320&upperTick=-276330`,
    },
  ];

  for (const test of tests) {
    console.log(`🔍 ${test.name}`);
    console.log(`   URL: ${test.url}`);
    
    try {
      const response = await makeRequest(test.url);
      
      console.log(`   ✅ Status: ${response.statusCode}`);
      console.log(`   ⏱️  Response time: ${response.responseTime}ms`);
      
      if (response.responseTime > 100) {
        console.log(`   ⚠️  Warning: Response time exceeds 100ms requirement`);
      }
      
      if (response.statusCode === 200) {
        const ticks = JSON.parse(response.body);
        console.log(`   📊 Ticks returned: ${ticks.length}`);
        
        if (ticks.length > 0) {
          console.log(`   📈 First tick: ${JSON.stringify(ticks[0], null, 2)}`);
          
          // Verify ticks are in ascending order
          let inOrder = true;
          for (let i = 1; i < ticks.length; i++) {
            if (ticks[i].tickIndex <= ticks[i - 1].tickIndex) {
              inOrder = false;
              break;
            }
          }
          
          if (inOrder) {
            console.log(`   ✅ Ticks are in ascending order`);
          } else {
            console.log(`   ❌ Ticks are NOT in ascending order`);
          }
        }
      } else {
        const errorBody = JSON.parse(response.body);
        console.log(`   📝 Error: ${errorBody.message || 'Unknown error'}`);
      }
      
    } catch (error) {
      console.log(`   ❌ Request failed: ${error.message}`);
    }
    
    console.log('');
  }
  
  console.log('🏁 Testing complete!');
}

// Performance test
async function performanceTest() {
  console.log('🚀 Running performance test...');
  
  const url = `${BASE_URL}/pools/${POOL_ID}/ticks`;
  const iterations = 10;
  const times = [];
  
  for (let i = 0; i < iterations; i++) {
    try {
      const response = await makeRequest(url);
      times.push(response.responseTime);
      process.stdout.write('.');
    } catch (error) {
      console.log(`\n❌ Performance test failed: ${error.message}`);
      return;
    }
  }
  
  console.log('');
  
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const maxTime = Math.max(...times);
  const minTime = Math.min(...times);
  const p95Time = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
  
  console.log(`📊 Performance Results (${iterations} requests):`);
  console.log(`   Average: ${avgTime.toFixed(2)}ms`);
  console.log(`   Min: ${minTime}ms`);
  console.log(`   Max: ${maxTime}ms`);
  console.log(`   P95: ${p95Time}ms`);
  
  if (p95Time <= 100) {
    console.log(`   ✅ P95 meets requirement (≤100ms)`);
  } else {
    console.log(`   ❌ P95 exceeds requirement (${p95Time}ms > 100ms)`);
  }
  
  console.log('');
}

async function main() {
  await testTicksEndpoint();
  await performanceTest();
}

if (require.main === module) {
  main().catch(console.error);
}