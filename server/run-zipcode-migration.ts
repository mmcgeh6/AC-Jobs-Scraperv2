import * as sql from 'mssql';
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

async function addZipcodeColumn() {
  try {
    console.log('🔧 Adding zipcode column to Azure SQL table...');
    
    const azureSqlUrl = process.env.AZURE_SQL_URL;
    if (!azureSqlUrl) {
      throw new Error('AZURE_SQL_URL not found in environment');
    }

    const config = parseJdbcConnectionString(azureSqlUrl);
    const pool = await sql.connect(config);

    const migrationSQL = `
      IF NOT EXISTS (
          SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'job_posting_listings' AND COLUMN_NAME = 'zipcode'
      )
      BEGIN
          ALTER TABLE job_posting_listings 
          ADD zipcode NVARCHAR(20);
          
          PRINT 'Zipcode column added successfully';
      END
      ELSE
      BEGIN
          PRINT 'Zipcode column already exists';
      END
    `;

    await pool.request().query(migrationSQL);
    console.log('✅ Zipcode column migration completed');

    await pool.close();

  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

addZipcodeColumn();