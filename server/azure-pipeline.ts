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
    console.log('🚀 Starting Azure pipeline execution...');
    
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

      await this.logActivity('Pipeline execution started', 'info');

      // Step 1: Fetch jobs from Algolia
      await this.sendProgress({ step: 'Fetching jobs from Algolia', progress: 10 });
      const jobs = await this.fetchJobsFromAlgolia();
      console.log(`📥 Fetched ${jobs.length} jobs from Algolia`);

      await storage.updatePipelineExecution(execution.id, {
        totalJobs: jobs.length,
        currentStep: 'Processing jobs with AI',
      });

      // Step 2: Process jobs with AI and geocoding
      await this.sendProgress({ 
        step: 'Processing jobs with AI and geocoding', 
        progress: 30,
        totalJobs: jobs.length,
      });

      const enrichedJobs = [];
      let processedCount = 0;

      for (const job of jobs) {
        try {
          // Process location with AI
          const aiLocation = await this.processLocationWithAI(job);
          
          // Get coordinates from Google Geocoding
          const coordinates = await this.getCoordinates(aiLocation);

          // Create enriched job object matching Azure SQL schema
          const enrichedJob = {
            jobId: String(job.data.jobID),
            jobUrl: job.data.externalPath,
            title: job.data.title,
            city: aiLocation.city,
            state: aiLocation.state,
            country: aiLocation.country,
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
          const progress = 30 + (processedCount / jobs.length) * 50;
          await this.sendProgress({
            step: 'Processing jobs with AI and geocoding',
            progress: Math.round(progress),
            processedJobs: processedCount,
            totalJobs: jobs.length,
          });

          await storage.updatePipelineExecution(execution.id, {
            processedJobs: processedCount,
          });

        } catch (error) {
          console.error(`Failed to process job ${job.data.jobID}:`, error);
          await this.logActivity(`Failed to process job ${job.data.title}: ${error.message}`, 'error');
          processedCount++;
        }
      }

      // Step 3: Synchronize with database
      const syncResult = await this.synchronizeDatabase(enrichedJobs);

      // Complete execution
      await storage.updatePipelineExecution(execution.id, {
        status: 'completed',
        endTime: new Date(),
        newJobs: syncResult.newJobs,
        removedJobs: syncResult.removedJobs,
        currentStep: 'Completed',
      });

      await this.logActivity('Pipeline execution completed successfully', 'success');

      await this.sendProgress({
        type: 'complete',
        message: 'Pipeline completed successfully',
        totalJobs: jobs.length,
        processedJobs: processedCount,
        newJobs: syncResult.newJobs,
        removedJobs: syncResult.removedJobs,
      });

      this.processedJobs = enrichedJobs;

    } catch (error) {
      console.error('Pipeline execution failed:', error);
      
      await storage.updatePipelineExecution(execution.id, {
        status: 'failed',
        endTime: new Date(),
        errorMessage: error.message,
      });

      await this.logActivity(`Pipeline execution failed: ${error.message}`, 'error');

      await this.sendProgress({
        type: 'error',
        message: `Pipeline failed: ${error.message}`,
      });

      throw error;
    }
  }

  private async fetchJobsFromAlgolia(): Promise<AlgoliaJob[]> {
    // For testing: fetch only 3 jobs total
    const url = `https://${process.env.ALGOLIA_APPLICATION_ID}.algolia.net/1/indexes/GROUP_EN_dateDesc/query`;
    const body = {
      params: `filters=data.country:"United States"&hitsPerPage=3&page=0&query=`
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
      
      console.log(`📄 Fetched ${data.hits.length} jobs for testing`);
      
      return data.hits;
      
    } catch (error) {
      console.error(`Failed to fetch jobs:`, error);
      throw error;
    }
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
        const parsed = JSON.parse(content);
        return {
          city: parsed.city || job.data.city,
          state: parsed.state || null,
          country: parsed.country || job.data.country,
        };
      } catch (parseError) {
        console.warn('Failed to parse AI response, using fallback:', content);
        return {
          city: job.data.city,
          state: null,
          country: job.data.country,
        };
      }
    } catch (error) {
      console.warn('AI processing failed, using original location:', error);
      return {
        city: job.data.city,
        state: null,
        country: job.data.country,
      };
    }
  }

  private async getCoordinates(location: AILocationResponse): Promise<{ latitude: string; longitude: string }> {
    const address = [location.city, location.state, location.country]
      .filter(Boolean)
      .join(', ');

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_GEOCODING_API_KEY}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Geocoding API error: ${response.status}`);
      }

      const result: GeocodingResponse = await response.json();
      
      if (result.status === 'OK' && result.results.length > 0) {
        const location = result.results[0].geometry.location;
        return {
          latitude: location.lat.toString(),
          longitude: location.lng.toString(),
        };
      } else {
        console.warn(`Geocoding failed for address: ${address}, status: ${result.status}`);
        return { latitude: null, longitude: null };
      }
    } catch (error) {
      console.warn(`Geocoding error for address: ${address}:`, error);
      return { latitude: null, longitude: null };
    }
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
        // Handle duplicate key errors gracefully (job already exists)
        if (!error.message.includes('UNIQUE KEY constraint')) {
          console.error(`Failed to create job posting for ${job.jobId}:`, error);
          await this.logActivity(`Failed to save job: ${job.title} - ${error.message}`, 'error');
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