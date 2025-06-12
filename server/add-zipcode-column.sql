-- Add zipcode column to existing job_posting_listings table
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