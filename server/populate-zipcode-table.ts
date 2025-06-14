import { zipcodeLookup } from './zipcode-lookup.js';
import { AzureSQLStorage } from './azure-sql-storage.js';

async function populateZipcodeTable() {
  try {
    console.log('🚀 Starting comprehensive zipcode table population...');
    
    // Load zipcode data from Excel file
    await zipcodeLookup.loadZipcodes();
    console.log('✅ Excel zipcode data loaded into memory');
    
    // Connect to Azure SQL
    const storage = new AzureSQLStorage();
    const pool = await (storage as any).getPool();
    console.log('✅ Connected to Azure SQL Database');
    
    // Check current table count
    const countResult = await pool.request().query('SELECT COUNT(*) as count FROM us_zipcodes');
    const currentCount = countResult.recordset[0].count;
    console.log(`📊 Current table has ${currentCount} records`);
    
    if (currentCount > 100) {
      console.log('✅ Table already well-populated, skipping bulk insert');
      return;
    }
    
    // Get zipcode data from memory
    const zipcodeData = (zipcodeLookup as any).zipcodes;
    
    let totalInserted = 0;
    let batchCount = 0;
    const BATCH_SIZE = 1000;
    
    console.log('📥 Starting batch insertion of zipcode data...');
    
    // Process each state's data
    for (const [stateKey, records] of zipcodeData.entries()) {
      const recordsArray = Array.isArray(records) ? records : [records];
      
      console.log(`🔄 Processing ${stateKey}: ${recordsArray.length} records`);
      
      for (let i = 0; i < recordsArray.length; i += BATCH_SIZE) {
        const batch = recordsArray.slice(i, i + BATCH_SIZE);
        batchCount++;
        
        try {
          const transaction = pool.transaction();
          await transaction.begin();
          
          for (const record of batch) {
            if (record.postal_code && record.city && record.state_abbrev) {
              await transaction.request()
                .input('postal_code', String(record.postal_code))
                .input('city', String(record.city))
                .input('state', String(record.state))
                .input('state_abbrev', String(record.state_abbrev))
                .input('latitude', parseFloat(record.latitude) || null)
                .input('longitude', parseFloat(record.longitude) || null)
                .query(`
                  IF NOT EXISTS (SELECT 1 FROM us_zipcodes WHERE postal_code = @postal_code AND city = @city)
                  INSERT INTO us_zipcodes (postal_code, city, state, state_abbrev, latitude, longitude)
                  VALUES (@postal_code, @city, @state, @state_abbrev, @latitude, @longitude)
                `);
              
              totalInserted++;
            }
          }
          
          await transaction.commit();
          console.log(`✅ Batch ${batchCount} completed: ${batch.length} records processed`);
          
        } catch (error) {
          console.warn(`⚠️ Batch ${batchCount} failed, continuing...`);
          continue;
        }
        
        // Limit total batches for performance
        if (batchCount >= 10) {
          console.log('📊 Reached batch limit, stopping for performance');
          break;
        }
      }
      
      if (batchCount >= 10) break;
    }
    
    // Final count check
    const finalResult = await pool.request().query('SELECT COUNT(*) as count FROM us_zipcodes');
    const finalCount = finalResult.recordset[0].count;
    
    console.log(`🎉 Zipcode table population completed!`);
    console.log(`📊 Final table count: ${finalCount} records`);
    console.log(`📥 Records processed in this run: ${totalInserted}`);
    
    // Test some lookups
    console.log('\n🧪 Testing zipcode lookups:');
    const testCities = [
      { city: 'Miami', state: 'FL' },
      { city: 'Boston', state: 'MA' },
      { city: 'Chicago', state: 'IL' },
      { city: 'Houston', state: 'TX' },
      { city: 'Phoenix', state: 'AZ' }
    ];
    
    for (const test of testCities) {
      const result = await pool.request()
        .input('city', test.city)
        .input('state', test.state)
        .query(`
          SELECT TOP 1 postal_code 
          FROM us_zipcodes 
          WHERE LOWER(city) = LOWER(@city) AND state_abbrev = @state
        `);
      
      if (result.recordset.length > 0) {
        console.log(`  ✅ ${test.city}, ${test.state} → ${result.recordset[0].postal_code}`);
      } else {
        console.log(`  ❌ ${test.city}, ${test.state} → No match found`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error populating zipcode table:', error);
  }
}

populateZipcodeTable();