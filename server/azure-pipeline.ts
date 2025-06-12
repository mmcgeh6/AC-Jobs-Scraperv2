import { storage } from './storage';
import { WebSocket } from 'ws';

interface AlgoliaJob {
  data: {
    jobID: string;
    city: string;
    country: string;
    externalPath: string;
    lastDayToApply: string;
    title: string;
    businessArea: string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface AlgoliaResponse {
  hits: AlgoliaJob[];
  page: number;
  nbPages: number;
  nbHits: number;
}

interface AILocationResponse {
  city: string;
  state: string;
  country: string;
}

interface GeocodingResponse {
  results: Array<{
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
    address_components: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }>;
  status: string;
}

export class AzurePipelineService {
  private ws: WebSocket | null = null;
  private currentExecutionId: number | null = null;
  private processedJobs: any[] = [];

  setWebSocket(ws: WebSocket) {
    this.ws = ws;
  }

  private async sendProgress(data: any) {
    if (this.ws && this.ws.readyState === 1) { // 1 = OPEN state
      this.ws.send(JSON.stringify(data));
    }
  }

  private async logActivity(message: string, level: 'info' | 'warning' | 'error' | 'success' = 'info') {
    console.log(`[${level.toUpperCase()}] ${message}`);
    try {
      await storage.createActivityLog({
        message,
        level,
        executionId: this.currentExecutionId,
      });
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }

  async executePipeline(batchSize: number = 100): Promise<void> {
    console.log(`🚀 Starting Azure pipeline execution with batch size: ${batchSize}`);
    
    const execution = await storage.createPipelineExecution({
      status: 'running',
      startTime: new Date(),
      currentStep: 'Initializing',
    });

    this.currentExecutionId = execution.id;

    try {
      await this.sendProgress({
        type: 'status',
        status: 'Starting pipeline execution',
        step: 'Initializing',
        progress: 0,
      });

      await this.logActivity(`Pipeline execution started with batch size: ${batchSize}`, 'info');

      // Step 1: Fetch jobs from Algolia
      await this.sendProgress({ 
        type: 'status',
        status: 'Fetching jobs from Algolia',
        step: 'Fetching jobs from Algolia', 
        progress: 10 
      });
      
      const allJobs = await this.fetchJobsFromAlgolia();
      
      // Apply batch size limit immediately
      const jobsToProcess = allJobs.slice(0, batchSize);
      console.log(`📊 Limited to ${jobsToProcess.length} jobs (batch size: ${batchSize} of ${allJobs.length} total)`);

      await storage.updatePipelineExecution(execution.id, {
        totalJobs: jobsToProcess.length,
        currentStep: 'Comparing with existing data',
      });

      // Step 2: Compare Algolia job IDs with existing SQL table records
      await this.sendProgress({ 
        type: 'status',
        status: 'Comparing with existing database records',
        step: 'Comparing with existing data', 
        progress: 20,
        totalJobs: jobsToProcess.length,
      });

      const existingJobs = await storage.getAllJobPostings();
      const existingJobIds = new Set(existingJobs.map(job => job.jobId));
      const algoliaJobIds = new Set(jobsToProcess.map(job => String(job.data.jobID)));

      // Step 3: Identify new jobs that need processing
      const newJobs = jobsToProcess.filter(job => !existingJobIds.has(String(job.data.jobID)));
      
      // Step 4: Identify obsolete jobs that need deletion
      const jobsToDelete = existingJobs.filter(job => !algoliaJobIds.has(job.jobId));

      console.log(`📋 Found ${newJobs.length} new jobs to process, ${jobsToDelete.length} obsolete jobs to delete`);
      await this.logActivity(`Found ${newJobs.length} new jobs, ${jobsToDelete.length} obsolete jobs`, 'info');

      // Step 5: Delete obsolete jobs from SQL table
      if (jobsToDelete.length > 0) {
        await this.sendProgress({ 
          type: 'status',
          status: `Removing ${jobsToDelete.length} obsolete jobs`,
          step: 'Removing obsolete jobs', 
          progress: 30,
          totalJobs: jobsToProcess.length,
        });

        for (const jobToDelete of jobsToDelete) {
          try {
            await storage.deleteJobPosting(jobToDelete.jobId);
            console.log(`🗑️ Deleted obsolete job: ${jobToDelete.title} (${jobToDelete.jobId})`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Failed to delete job ${jobToDelete.jobId}:`, error);
            await this.logActivity(`Failed to delete obsolete job ${jobToDelete.title}: ${errorMessage}`, 'warning');
          }
        }
        await this.logActivity(`Removed ${jobsToDelete.length} obsolete jobs from database`, 'success');
      }

      // Step 6: Process new jobs with Azure OpenAI and Google Geocoding
      const enrichedJobs = [];
      let processedCount = 0;

      if (newJobs.length > 0) {
        await this.sendProgress({ 
          type: 'status',
          status: `Processing ${newJobs.length} new jobs with AI`,
          step: 'Processing new jobs with AI', 
          progress: 40,
          totalJobs: newJobs.length,
        });

        for (const job of newJobs) {
          try {
            // Process location with Azure OpenAI
            const aiLocation = await this.processLocationWithAI(job);
            
            // Get coordinates from Google Geocoding
            const coordinates = await this.getCoordinates(aiLocation);

            // Create enriched job object
            const enrichedJob = {
              jobId: String(job.data.jobID),
              jobUrl: job.data.externalPath,
              title: job.data.title,
              city: aiLocation.city,
              state: aiLocation.state,
              country: aiLocation.country,
              zipcode: coordinates.zipcode,
              latitude: coordinates.latitude,
              longitude: coordinates.longitude,
              locationPoint: coordinates.latitude && coordinates.longitude 
                ? `POINT(${coordinates.longitude} ${coordinates.latitude})` 
                : null,
              description: job.data.businessArea || null,
              companyName: job.data.brand || job.data.company || null,
            };

            enrichedJobs.push(enrichedJob);
            processedCount++;

            // Send progress update
            const progress = 40 + (processedCount / newJobs.length) * 40;
            await this.sendProgress({
              type: 'status',
              status: `Processed ${processedCount}/${newJobs.length} new jobs`,
              step: 'Processing new jobs with AI',
              progress: Math.round(progress),
              processedJobs: processedCount,
              totalJobs: newJobs.length,
            });

          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Failed to process job ${job.data.jobID}:`, error);
            await this.logActivity(`Failed to process job ${job.data.title}: ${errorMessage}`, 'error');
            processedCount++;
          }
        }

        // Step 7: Add new enriched jobs to SQL table
        await this.sendProgress({ 
          type: 'status',
          status: `Adding ${enrichedJobs.length} new jobs to database`,
          step: 'Adding new jobs to database', 
          progress: 85,
          totalJobs: enrichedJobs.length,
        });

        let addedCount = 0;
        for (const enrichedJob of enrichedJobs) {
          try {
            await storage.createJobPosting(enrichedJob);
            addedCount++;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Failed to save job ${enrichedJob.jobId}:`, error);
            await this.logActivity(`Failed to save job ${enrichedJob.title}: ${errorMessage}`, 'warning');
          }
        }
        await this.logActivity(`Added ${addedCount} new job postings to database`, 'success');
      }

      // Store processed jobs for API access
      this.processedJobs = enrichedJobs;

      // Complete execution
      await storage.updatePipelineExecution(execution.id, {
        status: 'completed',
        endTime: new Date(),
        processedJobs: enrichedJobs.length,
        newJobs: enrichedJobs.length,
        removedJobs: jobsToDelete.length,
        currentStep: 'Completed',
      });

      await this.sendProgress({
        type: 'complete',
        message: `Pipeline completed successfully. Added ${enrichedJobs.length} new jobs, removed ${jobsToDelete.length} obsolete jobs.`,
        totalJobs: jobsToProcess.length,
        processedJobs: enrichedJobs.length,
        newJobs: enrichedJobs.length,
        removedJobs: jobsToDelete.length,
      });

      await this.logActivity(`Pipeline execution completed successfully. Added ${enrichedJobs.length} new jobs, removed ${jobsToDelete.length} obsolete jobs.`, 'success');

    } catch (error) {
      console.error('Pipeline execution failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      await storage.updatePipelineExecution(execution.id, {
        status: 'failed',
        endTime: new Date(),
        errorMessage,
      });

      await this.logActivity(`Pipeline execution failed: ${errorMessage}`, 'error');

      await this.sendProgress({
        type: 'error',
        message: `Pipeline failed: ${errorMessage}`,
      });

      throw error;
    }
  }

  private async fetchJobsFromAlgolia(): Promise<AlgoliaJob[]> {
    // Fetch all available jobs with pagination
    const url = `https://${process.env.ALGOLIA_APPLICATION_ID}.algolia.net/1/indexes/GROUP_EN_dateDesc/query`;
    let allJobs: AlgoliaJob[] = [];
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const body = {
        params: `filters=data.country:"United States"&hitsPerPage=1000&page=${page}&query=`
      };

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'X-Algolia-API-Key': process.env.ALGOLIA_API_KEY!,
            'X-Algolia-Application-Id': process.env.ALGOLIA_APPLICATION_ID!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`Algolia API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as AlgoliaResponse;
        allJobs.push(...data.hits);
        totalPages = data.nbPages;
        page++;

        console.log(`📄 Fetched page ${page}/${totalPages} with ${data.hits.length} jobs (Total: ${allJobs.length})`);
        
      } catch (error) {
        console.error(`Failed to fetch jobs:`, error);
        throw error;
      }
    }

    console.log(`📥 Fetched ${allJobs.length} jobs from Algolia`);
    return allJobs;
  }

  private async processLocationWithAI(job: AlgoliaJob): Promise<AILocationResponse> {
    // Build comprehensive job context using all available information
    const jobTitle = job.data.title || '';
    const jobUrl = job.data.externalPath || '';
    const city = job.data.city || '';
    const country = job.data.country || '';
    const description = job.data.businessArea || '';
    
    const prompt = `Analyze this job posting and extract the complete location information:

Job Title: ${jobTitle}
Job URL: ${jobUrl}
Location: ${city}, ${country}
Description: ${description}

Based on this job information, determine the full standardized location. Use the job title, URL domain, and description context to help identify the specific state/province for "${city}" in ${country}.

Return a JSON object with these exact fields:
- city: The city name (standardized)
- state: The state/province name (full name, not abbreviation)
- country: The country name (standardized)

For US locations, always include the state. Examples:
- Houston → Texas
- Michigan City → Indiana
- Charlotte → North Carolina

Use the job context and URL to determine the most accurate location.`;

    try {
      const response = await fetch(
        `https://${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=2024-02-15-preview`,
        {
          method: 'POST',
          headers: {
            'api-key': process.env.AZURE_OPENAI_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            max_tokens: 150,
            temperature: 0.1,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Azure OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      try {
        // Clean the response by removing markdown code blocks
        let cleanContent = content.trim();
        if (cleanContent.includes('```json')) {
          const jsonStart = cleanContent.indexOf('{');
          const jsonEnd = cleanContent.lastIndexOf('}') + 1;
          cleanContent = cleanContent.substring(jsonStart, jsonEnd);
        }
        
        const parsed = JSON.parse(cleanContent);
        console.log(`✅ Successfully parsed AI response for ${job.data.city}: city=${parsed.city}, state=${parsed.state}, country=${parsed.country}`);
        return {
          city: parsed.city || job.data.city,
          state: parsed.state || null,
          country: parsed.country || job.data.country,
        };
      } catch (parseError) {
        console.warn('⚠️ JSON parse failed, extracting with regex from:', content.substring(0, 200));
        
        // Improved regex patterns to extract location data from various formats
        const cityMatch = content.match(/"city":\s*"([^"]+)"/i) || content.match(/city.*?:\s*"?([^",\n]+)"?/i);
        const stateMatch = content.match(/"state":\s*"([^"]+)"/i) || content.match(/state.*?:\s*"?([^",\n]+)"?/i);
        const countryMatch = content.match(/"country":\s*"([^"]+)"/i) || content.match(/country.*?:\s*"?([^",\n]+)"?/i);
        
        const extractedCity = cityMatch?.[1]?.trim() || job.data.city;
        const extractedState = stateMatch?.[1]?.trim() || null;
        const extractedCountry = countryMatch?.[1]?.trim() || job.data.country;
        
        console.log(`🔍 Regex extracted for ${job.data.city}: city=${extractedCity}, state=${extractedState}, country=${extractedCountry}`);
        
        return {
          city: extractedCity,
          state: extractedState,
          country: extractedCountry,
        };
      }
    } catch (error) {
      console.warn('AI processing failed, using original location:', error);
      return {
        city: job.data.city,
        state: '',
        country: job.data.country,
      };
    }
  }

  private async getCoordinates(location: AILocationResponse): Promise<{ latitude: string; longitude: string; zipcode: string }> {
    // Try multiple address formats to improve geocoding accuracy
    const addressFormats = [
      // Most specific first
      [location.city, location.state, location.country].filter(Boolean).join(', '),
      // Add "USA" if country is United States
      location.country === 'United States' ? 
        [location.city, location.state, 'USA'].filter(Boolean).join(', ') : null,
      // Try with state abbreviation if we have full state name
      location.state && location.country === 'United States' ? 
        [location.city, this.getStateAbbreviation(location.state), 'USA'].filter(Boolean).join(', ') : null,
    ].filter(Boolean);

    for (const address of addressFormats) {
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_GEOCODING_API_KEY}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          console.warn(`Geocoding API error for ${address}: ${response.status}`);
          continue;
        }

        const result: GeocodingResponse = await response.json();
        
        if (result.status === 'OK' && result.results.length > 0) {
          const locationData = result.results[0].geometry.location;
          
          // Extract postal code from address components
          const postalCode = result.results[0].address_components.find(
            component => component.types.includes('postal_code')
          );

          // Log the result for debugging
          const zipcode = postalCode?.long_name || '';
          console.log(`🎯 Geocoding success for "${address}": lat=${locationData.lat}, lng=${locationData.lng}, zip=${zipcode || 'none'}`);
          
          return {
            latitude: locationData.lat.toString(),
            longitude: locationData.lng.toString(),
            zipcode,
          };
        } else {
          console.warn(`Geocoding failed for address: ${address}, status: ${result.status}`);
        }
      } catch (error) {
        console.warn(`Geocoding error for address: ${address}:`, error);
      }
    }

    // If all attempts failed
    console.warn(`⚠️ All geocoding attempts failed for location: ${location.city}, ${location.state}, ${location.country}`);
    return { latitude: '', longitude: '', zipcode: '' };
  }

  private async synchronizeDatabase(enrichedJobs: any[]): Promise<{ newJobs: number; removedJobs: number }> {
    await this.sendProgress({ step: 'Synchronizing with database', progress: 90 });

    // For initial data load, directly insert all jobs
    let newJobsCount = 0;
    const jobsToRemove: any[] = []; // Initialize for future sync operations

    for (const job of enrichedJobs) {
      try {
        await storage.createJobPosting(job);
        newJobsCount++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Handle duplicate key errors gracefully (job already exists)
        if (!errorMessage.includes('UNIQUE KEY constraint')) {
          console.error(`Failed to create job posting for ${job.jobId}:`, error);
          await this.logActivity(`Failed to save job: ${job.title} - ${errorMessage}`, 'error');
        }
      }
    }

    await this.logActivity(`Added ${newJobsCount} new job postings to database`, 'success');

    return {
      newJobs: newJobsCount,
      removedJobs: jobsToRemove.length,
    };
  }

  getProcessedJobs(): any[] {
    return this.processedJobs;
  }

  private getStateAbbreviation(stateName: string): string {
    const stateMap: { [key: string]: string } = {
      'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
      'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
      'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
      'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
      'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
      'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
      'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
      'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
      'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
      'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
      'District of Columbia': 'DC'
    };
    
    return stateMap[stateName] || stateName;
  }
}

export const azurePipelineService = new AzurePipelineService();