import sql from 'mssql';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

function parseJdbcConnectionString(jdbcUrl: string) {
  // Parse JDBC connection string properly
  const parts = jdbcUrl.split(';');
  const serverPart = parts[0].replace('jdbc:sqlserver://', '');
  const [server, port] = serverPart.split(':');
  
  const config: any = {
    server: server,
    port: port ? parseInt(port) : 1433,
    database: 'master',
    user: '',
    password: '',
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  };
  
  // Parse other parameters
  for (let i = 1; i < parts.length; i++) {
    const [key, value] = parts[i].split('=');
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
  
  return config;
}

async function testAzureConnection() {
  try {
    console.log('🔍 Testing Azure SQL connection...');
    
    const azureUrl = process.env.AZURE_SQL_URL;
    if (!azureUrl) {
      console.log('❌ AZURE_SQL_URL not found');
      return;
    }
    
    console.log('✅ AZURE_SQL_URL found');
    console.log('📝 Parsing connection string...');
    
    const config = parseJdbcConnectionString(azureUrl);
    console.log('🔧 Connection config:', {
      server: config.server,
      database: config.database,
      user: config.user,
      hasPassword: !!config.password
    });
    
    console.log('🔌 Attempting connection...');
    const pool = await sql.connect(config);
    
    console.log('✅ Connected to Azure SQL Database');
    
    // Test table creation
    console.log('📋 Testing table creation...');
    const createTableQuery = `
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='job_posting_listings' AND xtype='U')
      CREATE TABLE job_posting_listings (
        id INT IDENTITY(1,1) PRIMARY KEY,
        job_id NVARCHAR(255) UNIQUE NOT NULL,
        job_url NVARCHAR(MAX),
        title NVARCHAR(500),
        city NVARCHAR(100),
        state NVARCHAR(100),
        country NVARCHAR(100),
        latitude NVARCHAR(50),
        longitude NVARCHAR(50),
        location_point NVARCHAR(100),
        description NVARCHAR(MAX),
        company_name NVARCHAR(255),
        created_at DATETIME DEFAULT GETDATE()
      )
    `;
    
    await pool.request().query(createTableQuery);
    console.log('✅ Table created or already exists');
    
    // Test simple insert
    console.log('💾 Testing data insertion...');
    const testInsert = `
      DELETE FROM job_posting_listings WHERE job_id = 'TEST_001';
      INSERT INTO job_posting_listings (job_id, job_url, title, city, state, country)
      VALUES ('TEST_001', 'https://test.com', 'Test Job', 'San Francisco', 'California', 'United States')
    `;
    
    await pool.request().query(testInsert);
    console.log('✅ Test data inserted');
    
    // Test select
    console.log('📊 Testing data retrieval...');
    const result = await pool.request().query('SELECT TOP 5 * FROM job_posting_listings ORDER BY created_at DESC');
    console.log('✅ Data retrieved:', result.recordset.length, 'records');
    
    await pool.close();
    console.log('✅ Azure SQL connection test completed successfully');
    
  } catch (error) {
    console.error('❌ Azure SQL connection test failed:', error);
  }
}

// Run test if called directly
testAzureConnection();

export { testAzureConnection };