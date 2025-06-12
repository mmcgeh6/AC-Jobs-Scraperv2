-- Migration script to add native GEOGRAPHY support to Azure SQL Database
-- This script updates the job_postings table to use proper geospatial data types

-- First, check if the location_point column exists and alter it to GEOGRAPHY type
IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'job_postings' AND COLUMN_NAME = 'location_point')
BEGIN
    -- If the column exists as text, we need to drop and recreate it as GEOGRAPHY
    ALTER TABLE job_postings DROP COLUMN location_point;
END

-- Add the location_point column as GEOGRAPHY data type
ALTER TABLE job_postings ADD location_point GEOGRAPHY;

-- Create a spatial index for better performance on geospatial queries
CREATE SPATIAL INDEX IX_job_postings_location_point 
ON job_postings(location_point)
USING GEOGRAPHY_GRID 
WITH (GRIDS =(LEVEL_1 = MEDIUM,LEVEL_2 = MEDIUM,LEVEL_3 = MEDIUM,LEVEL_4 = MEDIUM));

-- Update existing records to populate the geography column from lat/lng if they exist
UPDATE job_postings 
SET location_point = geography::Point(latitude, longitude, 4326)
WHERE latitude IS NOT NULL 
  AND longitude IS NOT NULL 
  AND latitude != 0 
  AND longitude != 0;

PRINT 'Database migration completed: Added GEOGRAPHY support to job_postings table';