import { AzurePipelineService } from './azure-pipeline.js';

// Test the zipcode fallback system
async function testZipcodeFallback() {
  const pipeline = new AzurePipelineService();
  
  // Test locations that typically don't return postal codes in basic city queries
  const testLocations = [
    { city: 'Boston', state: 'Massachusetts', country: 'United States' },
    { city: 'Houston', state: 'Texas', country: 'United States' },
    { city: 'Phoenix', state: 'Arizona', country: 'United States' },
    { city: 'Miami', state: 'Florida', country: 'United States' },
    { city: 'Seattle', state: 'Washington', country: 'United States' }
  ];

  console.log('🧪 Testing enhanced zipcode fallback system...\n');

  for (const location of testLocations) {
    console.log(`Testing: ${location.city}, ${location.state}`);
    
    try {
      // Access the private method using bracket notation
      const result = await (pipeline as any).getCoordinates(location);
      
      console.log(`  ✅ Result: lat=${result.latitude}, lng=${result.longitude}, zip=${result.zipcode || 'NONE'}`);
      console.log(`  📍 Zipcode found: ${result.zipcode ? 'YES' : 'NO'}\n`);
    } catch (error) {
      console.log(`  ❌ Error: ${error}\n`);
    }
  }
  
  console.log('🏁 Zipcode fallback test completed');
}

testZipcodeFallback().catch(console.error);