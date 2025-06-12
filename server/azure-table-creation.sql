-- Azure SQL script to create job_posting_listings table
-- Run this in your Azure SQL database to create the new table

CREATE TABLE job_posting_listings (
    id INT IDENTITY(1,1) PRIMARY KEY,
    job_id NVARCHAR(255) NOT NULL UNIQUE,
    job_url NVARCHAR(1000) NOT NULL,
    title NVARCHAR(500) NOT NULL,
    description NVARCHAR(MAX),
    company_name NVARCHAR(255),
    city NVARCHAR(100),
    state NVARCHAR(100),
    country NVARCHAR(100),
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    location_point GEOGRAPHY, -- Native geospatial support in Azure SQL
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE()
);

-- Create spatial index for geospatial queries
CREATE SPATIAL INDEX IX_job_posting_listings_location_point 
ON job_posting_listings(location_point)
USING GEOGRAPHY_GRID 
WITH (GRIDS =(LEVEL_1 = MEDIUM,LEVEL_2 = MEDIUM,LEVEL_3 = MEDIUM,LEVEL_4 = MEDIUM));

-- Create index on job_id for fast lookups
CREATE INDEX IX_job_posting_listings_job_id ON job_posting_listings(job_id);

PRINT 'job_posting_listings table created successfully with geospatial support';