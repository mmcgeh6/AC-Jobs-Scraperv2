import XLSX from 'xlsx';
import sql from 'mssql';

interface ZipcodeRecord {
  postal_code: string;
  city: string;
  state: string;
  state_abbrev: string;
  latitude: number;
  longitude: number;
}

function parseJdbcConnectionString(jdbcUrl: string) {
  // Parse JDBC connection string properly
  const parts = jdbcUrl.split(';');
  const serverPart = parts[0].replace('jdbc:sqlserver://', '');
  const [server, port] = serverPart.split(':');
  
  const config: any = {
    server: server,
    port: port ? parseInt(port) : 1433,
    options: {
      encrypt: true,
      trustServerCertificate: true
    }
  };
  
  // Parse additional connection parameters
  for (let i = 1; i < parts.length; i++) {
    const [key, value] = parts[i].split('=');
    if (key && value) {
      switch (key.toLowerCase()) {
        case 'database':
          config.database = value;
          break;
        case 'user':
          config.user = value;
          break;
        case 'password':
          config.password = value;
          break;
      }
    }
  }
  
  return config;
}

async function createZipcodeTable() {
  try {
    // Use Azure SQL URL if available, otherwise DATABASE_URL
    const azureUrl = process.env.AZURE_SQL_URL || process.env.DATABASE_URL!;
    const config = parseJdbcConnectionString(azureUrl);
    const pool = await sql.connect(config);
    
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
    
    // Insert data in batches
    const batchSize = 1000;
    let insertedCount = 0;
    
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      // Build batch insert query
      const values = batch.map(row => {
        const postalCode = String(row['postal code'] || '').trim();
        const city = String(row['City'] || '').trim();
        const state = String(row['State'] || '').trim();
        const stateAbbrev = String(row['State Abbrev'] || '').trim();
        const latitude = parseFloat(row['latitude']) || null;
        const longitude = parseFloat(row['longitude']) || null;
        
        return `('${postalCode.replace(/'/g, "''")}', '${city.replace(/'/g, "''")}', '${state.replace(/'/g, "''")}', '${stateAbbrev}', ${latitude}, ${longitude})`;
      }).join(',');
      
      const insertQuery = `
        INSERT INTO us_zipcodes (postal_code, city, state, state_abbrev, latitude, longitude)
        VALUES ${values}
      `;
      
      await pool.request().query(insertQuery);
      insertedCount += batch.length;
      
      if (insertedCount % 5000 === 0) {
        console.log(`📥 Inserted ${insertedCount}/${data.length} records...`);
      }
    }
    
    console.log(`✅ Successfully inserted ${insertedCount} zipcode records`);
    
    // Test some lookups
    console.log('\n🧪 Testing zipcode lookups:');
    
    const testCities = [
      { city: 'Boston', state: 'MA' },
      { city: 'Houston', state: 'TX' },
      { city: 'Phoenix', state: 'AZ' }
    ];
    
    for (const test of testCities) {
      const result = await pool.request()
        .input('city', sql.VarChar, test.city)
        .input('state', sql.VarChar, test.state)
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
    
    await pool.close();
    console.log('\n🎉 Zipcode table setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Error setting up zipcode table:', error);
  }
}

createZipcodeTable();