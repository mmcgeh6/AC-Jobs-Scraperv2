import * as sql from 'mssql';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

function parseJdbcConnectionString(jdbcUrl: string) {
  // Remove quotes if present
  const cleanUrl = jdbcUrl.replace(/^"/, '').replace(/"$/, '');
  
  // Parse connection string format: server:port;database=name;user=user;password=pass;...
  const parts = cleanUrl.split(';');
  const serverPort = parts[0];
  const [server, port] = serverPort.split(':');
  
  const config: any = {
    server: server,
    port: port ? parseInt(port) : 1433,
    options: {
      encrypt: true,
      trustServerCertificate: false
    }
  };
  
  // Parse remaining parameters
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

async function runMigration() {
  try {
    console.log('Starting database migration...');
    
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    const config = parseJdbcConnectionString(DATABASE_URL);
    console.log('Connecting to Azure SQL with config:', {
      server: config.server,
      database: config.database,
      user: config.user,
      port: config.port
    });

    const pool = new sql.ConnectionPool(config);
    await pool.connect();
    console.log('✅ Connected to Azure SQL Database');

    // Read migration script
    const migrationPath = path.join(__dirname, 'database-migration.sql');
    const migrationScript = fs.readFileSync(migrationPath, 'utf8');

    // Execute migration
    const request = pool.request();
    await request.query(migrationScript);
    
    console.log('✅ Database migration completed successfully');
    
    await pool.close();
    console.log('Database connection closed');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();