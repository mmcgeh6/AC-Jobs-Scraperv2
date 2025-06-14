import XLSX from 'xlsx';
import { AzureSQLStorage } from './azure-sql-storage.js';

async function createZipcodeTableInAzureSQL() {
  try {
    console.log('🚀 Creating us_zipcodes table in Azure SQL...');
    
    const storage = new AzureSQLStorage();
    const pool = await (storage as any).getPool();
    
    console.log('✅ Connected to Azure SQL Database');
    
    // Drop table if exists
    await pool.request().query(`
      IF OBJECT_ID('us_zipcodes', 'U') IS NOT NULL
        DROP TABLE us_zipcodes
    `);
    
    // Create the zipcode table
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
    
    console.log('✅ Created us_zipcodes table');
    
    // Create indexes for fast lookups
    await pool.request().query(`
      CREATE INDEX IX_us_zipcodes_city_state ON us_zipcodes(city, state_abbrev)
    `);
    
    await pool.request().query(`
      CREATE INDEX IX_us_zipcodes_postal_code ON us_zipcodes(postal_code)
    `);
    
    console.log('✅ Created indexes for fast lookups');
    
    // Read Excel file
    const filePath = 'attached_assets/US Zips with Lat_Long_1749766376077.xlsx';
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet) as any[];
    
    console.log(`📊 Processing ${data.length} zipcode records...`);
    
    // Insert data in batches using prepared statements
    let insertedCount = 0;
    
    for (const row of data) {
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
          
          if (insertedCount % 1000 === 0) {
            console.log(`📥 Inserted ${insertedCount}/${data.length} records...`);
          }
        }
      } catch (error) {
        // Skip individual records that fail
        continue;
      }
    }
    
    console.log(`✅ Successfully inserted ${insertedCount} zipcode records into Azure SQL`);
    
    // Test lookups
    console.log('\n🧪 Testing zipcode lookups in Azure SQL:');
    
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
    
    // Show table count
    const countResult = await pool.request().query('SELECT COUNT(*) as total FROM us_zipcodes');
    console.log(`\n📊 Total records in us_zipcodes table: ${countResult.recordset[0].total}`);
    
    console.log('\n🎉 Azure SQL zipcode table setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Error creating zipcode table in Azure SQL:', error);
  }
}

createZipcodeTableInAzureSQL();