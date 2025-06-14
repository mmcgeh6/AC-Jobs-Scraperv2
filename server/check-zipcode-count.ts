import { AzureSQLStorage } from './azure-sql-storage.js';

async function checkZipcodeCount() {
  try {
    console.log('🔍 Checking Azure SQL zipcode table count...');
    
    const storage = new AzureSQLStorage();
    const pool = await (storage as any).getPool();
    
    // Get current count
    const result = await pool.request().query('SELECT COUNT(*) as count FROM us_zipcodes');
    const count = result.recordset[0].count;
    
    console.log(`📊 Current zipcode records in Azure SQL: ${count.toLocaleString()}`);
    
    if (count >= 10000) {
      console.log('✅ Zipcode table well populated');
      
      // Test some lookups
      const testCities = [
        { city: 'Miami', state: 'FL' },
        { city: 'Boston', state: 'MA' },
        { city: 'Chicago', state: 'IL' },
        { city: 'Houston', state: 'TX' },
        { city: 'Phoenix', state: 'AZ' },
        { city: 'Seattle', state: 'WA' },
        { city: 'Denver', state: 'CO' },
        { city: 'Atlanta', state: 'GA' }
      ];
      
      console.log('\n🧪 Testing zipcode lookups:');
      for (const test of testCities) {
        const lookupResult = await pool.request()
          .input('city', test.city)
          .input('state', test.state)
          .query(`
            SELECT TOP 1 postal_code 
            FROM us_zipcodes 
            WHERE LOWER(city) = LOWER(@city) AND state_abbrev = @state
          `);
        
        if (lookupResult.recordset.length > 0) {
          console.log(`  ✅ ${test.city}, ${test.state} → ${lookupResult.recordset[0].postal_code}`);
        } else {
          console.log(`  ❌ ${test.city}, ${test.state} → No match found`);
        }
      }
    } else if (count > 100) {
      console.log('📈 Zipcode table partially populated, still loading...');
    } else {
      console.log('⚠️ Zipcode table has minimal data');
    }
    
  } catch (error) {
    console.error('❌ Error checking zipcode count:', error);
  }
}

checkZipcodeCount();