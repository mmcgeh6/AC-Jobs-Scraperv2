import sql from 'mssql';
import * as dotenv from 'dotenv';

dotenv.config();

function parseJdbcConnectionString(jdbcUrl: string) {
  const url = new URL(jdbcUrl.replace('jdbc:sqlserver://', 'https://'));
  const params = new URLSearchParams(url.search);
  
  return {
    server: url.hostname,
    port: url.port ? parseInt(url.port) : 1433,
    database: params.get('databaseName') || 'master',
    user: params.get('user') || '',
    password: params.get('password') || '',
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  };
}

async function createTable() {
  try {
    const jdbcUrl = process.env.DATABASE_URL;
    if (!jdbcUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    const config = parseJdbcConnectionString(jdbcUrl);
    const pool = await sql.connect(config);

    console.log('Connected to Azure SQL Database');

    const createTableSQL = `
      -- Create new simplified job_posting_listings table in Azure SQL
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'job_posting_listings')
      BEGIN
          CREATE TABLE job_posting_listings (
              id INT IDENTITY(1,1) PRIMARY KEY,
              job_id NVARCHAR(255) NOT NULL UNIQUE,
              job_url NVARCHAR(1000) NOT NULL,
              title NVARCHAR(500) NOT NULL,
              city NVARCHAR(100),
              state NVARCHAR(100),
              country NVARCHAR(100),
              latitude DECIMAL(10, 8),
              longitude DECIMAL(11, 8),
              location_point GEOGRAPHY,
              description NVARCHAR(MAX),
              company_name NVARCHAR(255),
              created_at DATETIME2 DEFAULT GETDATE()
          );

          -- Create index on job_id for fast lookups
          CREATE INDEX IX_job_posting_listings_job_id ON job_posting_listings(job_id);

          -- Create spatial index for geography queries
          CREATE SPATIAL INDEX IX_job_posting_listings_location_point 
          ON job_posting_listings(location_point)
          USING GEOGRAPHY_GRID 
          WITH (GRIDS =(LEVEL_1 = MEDIUM, LEVEL_2 = MEDIUM, LEVEL_3 = MEDIUM, LEVEL_4 = MEDIUM));

          PRINT 'Created job_posting_listings table successfully';
      END
      ELSE
      BEGIN
          PRINT 'Table job_posting_listings already exists';
      END
    `;

    await pool.request().query(createTableSQL);
    console.log('✅ Table creation completed successfully');

    // Test the table by checking its structure
    const schemaCheck = `
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'job_posting_listings' 
      ORDER BY ORDINAL_POSITION
    `;

    const result = await pool.request().query(schemaCheck);
    console.log('📋 Table schema:');
    result.recordset.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME}: ${col.DATA_TYPE} (nullable: ${col.IS_NULLABLE})`);
    });

    await pool.close();
  } catch (error) {
    console.error('❌ Error creating table:', error);
    process.exit(1);
  }
}

createTable();