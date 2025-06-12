import * as sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

function parseJdbcConnectionString(jdbcUrl: string) {
  const match = jdbcUrl.match(/jdbc:sqlserver:\/\/([^:]+):(\d+);database=([^;]+);(.+)/);
  if (!match) {
    throw new Error('Invalid JDBC connection string format');
  }

  const [, server, port, database, params] = match;
  const config: any = {
    server,
    port: parseInt(port),
    database,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  };

  // Parse additional parameters
  const paramPairs = params.split(';');
  for (const pair of paramPairs) {
    const [key, value] = pair.split('=');
    if (key === 'user') config.user = value;
    if (key === 'password') config.password = value;
  }

  return config;
}

async function verifyDatabaseCount() {
  try {
    console.log('🔍 Verifying Azure SQL Database record count...');
    
    const azureSqlUrl = process.env.AZURE_SQL_URL;
    if (!azureSqlUrl) {
      throw new Error('AZURE_SQL_URL not found in environment');
    }

    const config = parseJdbcConnectionString(azureSqlUrl);
    const pool = await sql.connect(config);

    // Get total count
    const countResult = await pool.request().query(
      'SELECT COUNT(*) as total_count FROM job_posting_listings'
    );
    
    // Get recent records
    const recentResult = await pool.request().query(
      'SELECT TOP 5 id, job_id, title, city, state, created_at FROM job_posting_listings ORDER BY created_at DESC'
    );

    // Get oldest records
    const oldestResult = await pool.request().query(
      'SELECT TOP 5 id, job_id, title, city, state, created_at FROM job_posting_listings ORDER BY created_at ASC'
    );

    console.log('\n📊 Database Verification Results:');
    console.log(`Total records: ${countResult.recordset[0].total_count}`);
    
    console.log('\n🕒 Most Recent Records:');
    recentResult.recordset.forEach((row: any) => {
      console.log(`- ID: ${row.id}, Job: ${row.job_id}, Title: ${row.title}, Location: ${row.city}, ${row.state}, Created: ${row.created_at}`);
    });

    console.log('\n🕐 Oldest Records:');
    oldestResult.recordset.forEach((row: any) => {
      console.log(`- ID: ${row.id}, Job: ${row.job_id}, Title: ${row.title}, Location: ${row.city}, ${row.state}, Created: ${row.created_at}`);
    });

    await pool.close();

  } catch (error) {
    console.error('❌ Database verification failed:', error);
  }
}

verifyDatabaseCount();