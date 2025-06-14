import sql from 'mssql';
import XLSX from 'xlsx';
import dotenv from 'dotenv';

dotenv.config();

interface ZipcodeRecord {
  postal_code: string;
  city: string;
  state: string;
  state_abbrev: string;
  latitude: number;
  longitude: number;
}

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

async function completeZipcodePopulation() {
  try {
    console.log('🚀 Starting complete zipcode population with all 41,483 records...');
    
    const azureSqlUrl = process.env.AZURE_SQL_URL;
    if (!azureSqlUrl) {
      throw new Error('AZURE_SQL_URL not found in environment');
    }

    const config = parseJdbcConnectionString(azureSqlUrl);
    const pool = await sql.connect(config);
    console.log('✅ Connected to Azure SQL Database');

    // Check current record count
    const countResult = await pool.request().query('SELECT COUNT(*) as count FROM us_zipcodes');
    const currentCount = countResult.recordset[0].count;
    console.log(`📊 Current zipcode table has ${currentCount} records`);

    // Read Excel file
    const filePath = 'attached_assets/US Zips with Lat_Long_1749766376077.xlsx';
    console.log('📋 Reading Excel file...');
    
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📥 Loaded ${data.length} records from Excel file`);

    // Process all records without any slicing limitations
    let insertedCount = 0;
    let skippedCount = 0;
    const batchSize = 1000;
    
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      console.log(`🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(data.length / batchSize)} (${batch.length} records)`);
      
      for (const row of batch) {
        try {
          const record = row as any;
          
          if (record.Zip && record.City && record.State) {
            // Check if record already exists
            const existsResult = await pool.request()
              .input('postal_code', String(record.Zip))
              .query('SELECT COUNT(*) as count FROM us_zipcodes WHERE postal_code = @postal_code');
            
            if (existsResult.recordset[0].count === 0) {
              await pool.request()
                .input('postal_code', String(record.Zip))
                .input('city', String(record.City))
                .input('state', String(record.State))
                .input('state_abbrev', String(record.State))
                .input('latitude', parseFloat(record.Latitude) || null)
                .input('longitude', parseFloat(record.Longitude) || null)
                .query(`
                  INSERT INTO us_zipcodes (postal_code, city, state, state_abbrev, latitude, longitude)
                  VALUES (@postal_code, @city, @state, @state_abbrev, @latitude, @longitude)
                `);
              
              insertedCount++;
            } else {
              skippedCount++;
            }
          }
        } catch (error) {
          console.warn(`Failed to insert record: ${error}`);
          continue;
        }
      }
      
      // Progress update every 5 batches
      if ((i / batchSize) % 5 === 0) {
        console.log(`📊 Progress: ${insertedCount} inserted, ${skippedCount} skipped so far...`);
      }
    }

    // Final count check
    const finalResult = await pool.request().query('SELECT COUNT(*) as count FROM us_zipcodes');
    const finalCount = finalResult.recordset[0].count;
    
    console.log(`🎉 Complete zipcode population finished!`);
    console.log(`📊 Final table count: ${finalCount} records`);
    console.log(`📥 Records inserted in this run: ${insertedCount}`);
    console.log(`⏭️ Records skipped (already existed): ${skippedCount}`);
    console.log(`📋 Total Excel records processed: ${data.length}`);

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
    console.log('\n✅ Complete zipcode population script finished successfully!');

  } catch (error) {
    console.error('❌ Complete zipcode population failed:', error);
    process.exit(1);
  }
}

completeZipcodePopulation();