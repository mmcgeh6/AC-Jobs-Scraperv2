# Jobs Pipeline Control Center - Azure Function Apps

## Overview

This is a full-stack web application that serves as a control center for managing an automated job data pipeline. The system fetches job postings from Algolia, enriches them with AI-powered location data using Azure OpenAI, and stores them in an Azure SQL database. The application provides real-time monitoring, manual pipeline execution, and comprehensive logging capabilities.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Bundler**: Vite for development and production builds
- **UI Framework**: shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with custom Azure-themed color palette
- **State Management**: TanStack Query for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Real-time Communication**: WebSocket connection for live pipeline updates

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **Database ORM**: Drizzle ORM configured for PostgreSQL (adaptable to Azure SQL)
- **Real-time Communication**: WebSocket server for pipeline status broadcasting
- **External Integrations**: Azure OpenAI API for location enrichment

### Database Strategy
The application is designed with flexibility in mind regarding database selection:
- **Primary**: Configured for Azure SQL Server with JDBC connection strings
- **Fallback**: PostgreSQL support through Drizzle ORM configuration
- **Migration**: SQL scripts provided for Azure SQL table creation and data migration

## Key Components

### Pipeline Engine
- **Job Fetching**: Algolia search API integration for job data retrieval
- **AI Enrichment**: Azure OpenAI service for location standardization and geocoding
- **Batch Processing**: Configurable batch sizes for efficient data processing
- **Error Handling**: Comprehensive error recovery and logging mechanisms

### Data Models
- **Job Posting Listings**: Core job data with location coordinates and metadata
- **Pipeline Executions**: Execution tracking with status, timing, and metrics
- **Activity Logs**: Detailed logging system with multiple severity levels
- **Zipcode Lookup**: US postal code database for enhanced location matching

### Real-time Monitoring
- **WebSocket Integration**: Live updates for pipeline progress and status changes
- **Progress Tracking**: Visual progress bars and completion metrics
- **Activity Streaming**: Real-time log streaming with color-coded severity levels

## Data Flow

1. **Pipeline Initiation**: User triggers pipeline execution through web interface
2. **Job Retrieval**: System fetches job listings from Algolia search API
3. **AI Processing**: Each job's location data is enriched using Azure OpenAI
4. **Geocoding**: Location strings are converted to coordinates and postal codes
5. **Database Storage**: Processed jobs are stored in Azure SQL database
6. **Real-time Updates**: Progress and status updates are broadcast via WebSocket
7. **Completion Reporting**: Final metrics and logs are presented to user

## External Dependencies

### Azure Services
- **Azure SQL Database**: Primary data storage with geospatial capabilities
- **Azure OpenAI**: GPT-4o-mini model for location data processing and standardization

### Third-party APIs
- **Algolia Search**: Job listing data source with pagination support
- **Google Geocoding** (Optional): Fallback for coordinate resolution

### Development Tools
- **Drizzle Kit**: Database migration and schema management
- **Replit Integration**: Development environment optimization with runtime error handling

## Deployment Strategy

### Production Build
- **Frontend**: Vite production build with optimized asset bundling
- **Backend**: ESBuild compilation for Node.js deployment
- **Database**: Drizzle schema push for production migration

### Environment Configuration
- **Database URLs**: Support for both JDBC (Azure SQL) and standard PostgreSQL connection strings
- **API Keys**: Secure environment variable management for Azure OpenAI credentials
- **CORS**: Configured for cross-origin requests in development and production

### Scaling Considerations
- **Batch Processing**: Configurable batch sizes to balance performance and resource usage
- **Connection Pooling**: Database connection management for high-throughput scenarios
- **Error Recovery**: Automatic retry mechanisms for transient failures

## Recent Changes
- **June 16, 2025 - Reliable Eastern Time Scheduling**: Implemented fallback scheduling system with hard-coded timezone conversion for 9:30 AM Eastern daily execution. Fixed timezone calculation issues and established reliable automated pipeline execution with 1000-job batches.
- **June 15, 2025 - Scheduling Enhancements**: Added customizable time picker for daily automated execution and increased batch size to 1000 jobs per batch for more efficient processing. Users can now set any execution time in Eastern timezone with real-time next run calculation.
- **June 14, 2025 - Production Ready**: Removed all development zipcode loading code, cleaned up CSV/Excel processing files. System now uses manually populated us_zipcodes table with 40,972 records for optimal zipcode extraction performance.
- **June 14, 2025**: Fixed array slicing limitations that prevented full zipcode dataset insertion
- **June 14, 2025**: Initial setup with Azure SQL integration and comprehensive zipcode lookup system

## User Preferences

Preferred communication style: Simple, everyday language.