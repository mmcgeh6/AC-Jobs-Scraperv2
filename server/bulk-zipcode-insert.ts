import sql from 'mssql';
import XLSX from 'xlsx';
import dotenv from 'dotenv';

dotenv.config();

function parseJdbcConnectionString(jdbcUrl: string) {
  const parts = jdbcUrl.split(';');
  const serverPart = parts[0].replace('jdbc:sqlserver://', '');
  const [server, port] = serverPart.split(':');
  
  const config: any = {
    server: server,
    port: port ? parseInt(port) : 1433,
    database: 'master',
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  };

  for (const part of parts.slice(1)) {
    const [key, value] = part.split('=');
    if (key === 'database') config.database = value;
    if (key === 'user') config.user = value;
    if (key === 'password') config.password = value;
  }

  return config;
}

async function bulkZipcodeInsert() {
  try {
    console.log('🚀 Starting bulk zipcode insertion for all 41,483 records...');
    
    const azureSqlUrl = process.env.AZURE_SQL_URL;
    if (!azureSqlUrl) {
      throw new Error('AZURE_SQL_URL not found in environment');
    }

    const config = parseJdbcConnectionString(azureSqlUrl);
    const pool = await sql.connect(config);
    console.log('✅ Connected to Azure SQL Database');

    // Clear existing data and recreate table for clean bulk insert
    console.log('🔄 Recreating zipcode table for bulk insert...');
    
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

    await pool.request().query(`
      CREATE INDEX IX_us_zipcodes_city_state ON us_zipcodes(city, state_abbrev)
    `);

    await pool.request().query(`
      CREATE INDEX IX_us_zipcodes_postal_code ON us_zipcodes(postal_code)
    `);

    console.log('✅ Created fresh zipcode table with indexes');

    // Read Excel file
    const filePath = 'attached_assets/US Zips with Lat_Long_1749766376077.xlsx';
    console.log('📋 Reading Excel file...');
    
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📥 Loaded ${data.length} records from Excel file`);

    // Use bulk insert with SQL table-valued parameter
    const table = new sql.Table('us_zipcodes');
    table.columns.add('postal_code', sql.VarChar(10), { nullable: false });
    table.columns.add('city', sql.VarChar(100), { nullable: false });
    table.columns.add('state', sql.VarChar(50), { nullable: false });
    table.columns.add('state_abbrev', sql.VarChar(2), { nullable: false });
    table.columns.add('latitude', sql.Decimal(10, 6), { nullable: true });
    table.columns.add('longitude', sql.Decimal(10, 6), { nullable: true });

    let validRecords = 0;
    let invalidRecords = 0;

    for (const row of data) {
      const record = row as any;
      
      if (record['postal code'] && record.City && record['State Abbrev']) {
        table.rows.add(
          String(record['postal code']),
          String(record.City),
          String(record.State),
          String(record['State Abbrev']),
          parseFloat(record.latitude) || null,
          parseFloat(record.longitude) || null
        );
        validRecords++;
      } else {
        invalidRecords++;
      }
    }

    console.log(`📊 Prepared ${validRecords} valid records for bulk insert (${invalidRecords} invalid records skipped)`);
    console.log('⚡ Executing bulk insert...');

    const startTime = Date.now();
    const request = pool.request();
    await request.bulk(table);
    const endTime = Date.now();

    console.log(`⚡ Bulk insert completed in ${(endTime - startTime) / 1000} seconds`);

    // Verify final count
    const finalResult = await pool.request().query('SELECT COUNT(*) as count FROM us_zipcodes');
    const finalCount = finalResult.recordset[0].count;
    
    console.log(`🎉 Bulk zipcode insertion completed!`);
    console.log(`📊 Final table count: ${finalCount} records`);

    // Test lookup functionality
    console.log('\n🧪 Testing zipcode lookups:');
    const testCities = [
      { city: 'New York', state: 'NY' },
      { city: 'Los Angeles', state: 'CA' },
      { city: 'Chicago', state: 'IL' },
      { city: 'Houston', state: 'TX' },
      { city: 'Phoenix', state: 'AZ' },
      { city: 'Miami', state: 'FL' },
      { city: 'Boston', state: 'MA' },
      { city: 'Seattle', state: 'WA' }
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
    
    await pool.close();
    console.log('\n✅ Bulk zipcode insertion script completed successfully!');

  } catch (error) {
    console.error('❌ Bulk zipcode insertion failed:', error);
    process.exit(1);
  }
}

bulkZipcodeInsert();