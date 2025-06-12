import XLSX from 'xlsx';
import { AzureSQLStorage } from './azure-sql-storage.js';

async function setupZipcodeLookup() {
  try {
    console.log('🚀 Setting up US zipcode lookup system...');
    
    const storage = new AzureSQLStorage();
    const pool = await (storage as any).getPool();
    
    // Create the zipcode table
    console.log('📋 Creating us_zipcodes table...');
    
    await pool.request().query(`
      IF OBJECT_ID('us_zipcodes', 'U') IS NOT NULL
        DROP TABLE us_zipcodes
    `);
    
    await pool.request().query(`
      CREATE TABLE us_zipcodes (
        id INT IDENTITY(1,1) PRIMARY KEY,
        postal_code VARCHAR(10) NOT NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(50) NOT NULL,
        state_abbrev VARCHAR(2) NOT NULL,
        latitude DECIMAL(10, 6),
        longitude DECIMAL(10, 6),
        created_at DATETIME2 DEFAULT GETDATE()
      )
    `);
    
    // Create indexes for fast lookups
    await pool.request().query(`
      CREATE INDEX IX_us_zipcodes_city_state ON us_zipcodes(city, state_abbrev)
    `);
    
    await pool.request().query(`
      CREATE INDEX IX_us_zipcodes_postal_code ON us_zipcodes(postal_code)
    `);
    
    console.log('✅ Created us_zipcodes table with indexes');
    
    // Read Excel file
    const filePath = 'attached_assets/US Zips with Lat_Long_1749766376077.xlsx';
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet) as any[];
    
    console.log(`📊 Processing ${data.length} zipcode records...`);
    
    // Insert data in smaller batches to avoid timeout
    const batchSize = 500;
    let insertedCount = 0;
    
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      // Build individual insert statements for safety
      for (const row of batch) {
        try {
          const postalCode = String(row['postal code'] || '').trim();
          const city = String(row['City'] || '').trim();
          const state = String(row['State'] || '').trim();
          const stateAbbrev = String(row['State Abbrev'] || '').trim();
          const latitude = parseFloat(row['latitude']) || null;
          const longitude = parseFloat(row['longitude']) || null;
          
          if (postalCode && city && state && stateAbbrev) {
            await pool.request()
              .input('postal_code', postalCode)
              .input('city', city)
              .input('state', state)
              .input('state_abbrev', stateAbbrev)
              .input('latitude', latitude)
              .input('longitude', longitude)
              .query(`
                INSERT INTO us_zipcodes (postal_code, city, state, state_abbrev, latitude, longitude)
                VALUES (@postal_code, @city, @state, @state_abbrev, @latitude, @longitude)
              `);
            
            insertedCount++;
          }
        } catch (error) {
          console.warn(`Failed to insert record:`, error);
        }
      }
      
      if (insertedCount % 2500 === 0) {
        console.log(`📥 Inserted ${insertedCount}/${data.length} records...`);
      }
    }
    
    console.log(`✅ Successfully inserted ${insertedCount} zipcode records`);
    
    // Test some lookups
    console.log('\n🧪 Testing zipcode lookups:');
    
    const testCities = [
      { city: 'Boston', state: 'MA' },
      { city: 'Houston', state: 'TX' },
      { city: 'Phoenix', state: 'AZ' },
      { city: 'Miami', state: 'FL' },
      { city: 'Seattle', state: 'WA' }
    ];
    
    for (const test of testCities) {
      const result = await pool.request()
        .input('city', test.city)
        .input('state', test.state)
        .query(`
          SELECT TOP 1 postal_code, city, state, state_abbrev 
          FROM us_zipcodes 
          WHERE LOWER(city) = LOWER(@city) AND state_abbrev = @state
        `);
      
      if (result.recordset.length > 0) {
        const record = result.recordset[0];
        console.log(`  ${test.city}, ${test.state} → ${record.postal_code}`);
      } else {
        console.log(`  ${test.city}, ${test.state} → No match found`);
      }
    }
    
    console.log('\n🎉 Zipcode lookup system setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Error setting up zipcode lookup:', error);
  }
}

setupZipcodeLookup();