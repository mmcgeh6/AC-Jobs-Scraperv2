import { storage } from "./storage";
import { WebSocket } from "ws";

interface AlgoliaJob {
  data: {
    jobID: string;
    city: string;
    country: string;
    externalPath: string;
    lastDayToApply: string;
    title: string;
    businessArea: string;
  };
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

export class PipelineService {
  private ws: WebSocket | null = null;
  private currentExecutionId: number | null = null;
  private processedJobs: any[] = [];

  setWebSocket(ws: WebSocket) {
    this.ws = ws;
  }

  private async sendProgress(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private async logActivity(message: string, level: 'info' | 'warning' | 'error' | 'success' = 'info') {
    await storage.createActivityLog({
      message,
      level,
      executionId: this.currentExecutionId,
    });
  }

  async executePipeline(batchSize: number = 100): Promise<void> {
    // Clear previous job data
    this.processedJobs = [];
    // Create pipeline execution record
    const execution = await storage.createPipelineExecution({
      status: 'running',
      startTime: new Date(),
      currentStep: 'Initializing...',
    });

    this.currentExecutionId = execution.id;

    try {
      await this.logActivity('Started manual pipeline execution', 'info');
      await this.sendProgress({ 
        type: 'status', 
        status: 'running', 
        step: 'Initializing...', 
        progress: 0 
      });

      // Step 1: Fetch jobs from Algolia
      await this.sendProgress({ 
        type: 'status', 
        step: 'Fetching jobs from Algolia...', 
        progress: 10 
      });
      
      const allJobs = await this.fetchJobsFromAlgolia();
      const jobs = allJobs.slice(0, batchSize); // Limit to batch size
      
      await storage.updatePipelineExecution(execution.id, {
        totalJobs: jobs.length,
        currentStep: `Fetched ${jobs.length} jobs from Algolia`,
      });

      await this.logActivity(`Fetched ${jobs.length} job listings from Algolia`, 'success');
      await this.sendProgress({ 
        type: 'status', 
        step: `Fetched ${jobs.length} jobs from Algolia`, 
        progress: 25,
        totalJobs: jobs.length
      });

      // Step 2: Process jobs with AI and Geocoding
      let processedCount = 0;
      const enrichedJobs = [];

      for (const job of jobs) {
        try {
          // AI Processing
          const aiResult = await this.processLocationWithAI(job);
          
          // Geocoding
          const coordinates = await this.getCoordinates(aiResult);
          
          const enrichedJob = {
            ...job,
            ...aiResult,
            ...coordinates
          };
          
          enrichedJobs.push(enrichedJob);
          
          // Store processed job data for dashboard viewing
          this.processedJobs.push({
            originalData: job.data,
            aiProcessed: aiResult,
            coordinates: coordinates,
            timestamp: new Date().toISOString()
          });

          processedCount++;
          const progress = 25 + (processedCount / jobs.length) * 50;
          
          await storage.updatePipelineExecution(execution.id, {
            processedJobs: processedCount,
            currentStep: `Processing locations (${processedCount}/${jobs.length})`,
          });

          await this.sendProgress({ 
            type: 'status', 
            step: `Processing locations with AI (${processedCount}/${jobs.length})`, 
            progress: Math.round(progress),
            processedJobs: processedCount
          });

          // Small delay to prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
          console.error(`Error processing job ${job.data.jobID}:`, error);
          await this.logActivity(`Error processing job ${job.data.jobID}: ${error.message}`, 'error');
        }
      }

      // Step 3: Database synchronization
      await this.sendProgress({ 
        type: 'status', 
        step: 'Synchronizing with database...', 
        progress: 80 
      });

      const { newJobs, removedJobs } = await this.synchronizeDatabase(enrichedJobs);

      await storage.updatePipelineExecution(execution.id, {
        status: 'completed',
        endTime: new Date(),
        newJobs,
        removedJobs,
        currentStep: 'Completed successfully',
      });

      await this.logActivity('Pipeline completed successfully', 'success');
      await this.sendProgress({ 
        type: 'complete', 
        progress: 100,
        newJobs,
        removedJobs
      });

    } catch (error) {
      await storage.updatePipelineExecution(execution.id, {
        status: 'failed',
        endTime: new Date(),
        errorMessage: error.message,
        currentStep: 'Failed',
      });

      await this.logActivity(`Pipeline failed: ${error.message}`, 'error');
      await this.sendProgress({ 
        type: 'error', 
        message: error.message 
      });

      throw error;
    }
  }

  private async fetchJobsFromAlgolia(): Promise<AlgoliaJob[]> {
    // Use your working script configuration
    const APP_ID = 'LXMKS8ARA3';
    const API_KEY = '933a2398c301661168ab0f240713ec3d';
    const INDEX_NAME = 'GROUP_EN_dateDesc';
    
    const allJobs: AlgoliaJob[] = [];
    let page = 0;
    let totalPages = 1;

    console.log('Starting job fetch from Algolia...');

    while (page < totalPages) {
      try {
        const response = await fetch(`https://${APP_ID}.algolia.net/1/indexes/${INDEX_NAME}/query`, {
          method: 'POST',
          headers: {
            'X-Algolia-API-Key': API_KEY,
            'X-Algolia-Application-Id': APP_ID,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            params: `filters=data.country:"United States"&hitsPerPage=100&page=${page}`
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Algolia API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const responseData = await response.json() as AlgoliaResponse;
        
        if (responseData.hits) {
          allJobs.push(...responseData.hits);
        }

        // On the first request, set the total number of pages
        if (page === 0) {
          totalPages = responseData.nbPages || 1;
          console.log(`Total pages to fetch: ${totalPages}`);
        }

        console.log(`Fetched page ${page + 1} of ${totalPages}. Total jobs so far: ${allJobs.length}`);
        
        page++;
        
        // Add small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        console.error(`Error fetching page ${page}:`, error);
        throw new Error(`Failed to fetch jobs on page ${page}: ${error.message}`);
      }
    }

    console.log(`Finished fetching. Total jobs found: ${allJobs.length}`);
    return allJobs;
  }

  private async processLocationWithAI(job: AlgoliaJob): Promise<AILocationResponse> {
    const AZURE_ENDPOINT = "https://ai-acgenaidevtest540461206109.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2025-01-01-preview";
    const API_KEY = process.env.AZURE_OPENAI_KEY || process.env.Azure_OpenAI_Key || "3fcde4edd6fd43b4968a8e0e716c61e5";

    const prompt = `From the input below, find and break down the City, State, and Country from the content. The input will be a mix of the city/state, a job URL which may contain the city and state, and a job title that may also contain it. Your job is to output the city, state, country in formatted json. Output the full state spelling, not the abbreviation.

Input:
City: ${job.data.city}
Country: ${job.data.country}
Job Title: ${job.data.title}
URL: ${job.data.externalPath}`;

    try {
      const response = await fetch(AZURE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': API_KEY,
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.8,
          max_tokens: 4096
        })
      });

      if (!response.ok) {
        throw new Error(`Azure OpenAI API error: ${response.status}`);
      }

      const result = await response.json();
      const content = result.choices[0]?.message?.content;
      
      try {
        const parsed = JSON.parse(content);
        return {
          city: parsed.city || job.data.city,
          state: parsed.state || '',
          country: parsed.country || job.data.country
        };
      } catch {
        // Fallback if JSON parsing fails
        return {
          city: job.data.city,
          state: '',
          country: job.data.country
        };
      }
    } catch (error) {
      console.error('AI processing error:', error);
      // Fallback to original data
      return {
        city: job.data.city,
        state: '',
        country: job.data.country
      };
    }
  }

  private async getCoordinates(location: AILocationResponse): Promise<{ latitude: string; longitude: string }> {
    const API_KEY = process.env.GOOGLE_GEOCODING_API_KEY || "AIzaSyA3MC5XeDbmLA0Mgv0U7CJTycwQlEVaCzc";
    const address = `${location.city}, ${location.state}, ${location.country}`.replace(/^,\s*|,\s*$/g, '');

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`
      );

      if (!response.ok) {
        throw new Error(`Geocoding API error: ${response.status}`);
      }

      const result: GeocodingResponse = await response.json();
      
      if (result.status === 'OK' && result.results.length > 0) {
        const location = result.results[0].geometry.location;
        return {
          latitude: location.lat.toString(),
          longitude: location.lng.toString()
        };
      } else {
        throw new Error(`Geocoding failed: ${result.status}`);
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      // Return default coordinates if geocoding fails
      return {
        latitude: '0',
        longitude: '0'
      };
    }
  }

  private async synchronizeDatabase(enrichedJobs: any[]): Promise<{ newJobs: number; removedJobs: number }> {
    const existingJobs = await storage.getAllJobPostings();
    const existingJobIDs = new Set(existingJobs.map(job => job.jobID).filter(Boolean));
    const newJobIDs = new Set(enrichedJobs.map(job => job.data.jobID));

    // Find jobs to remove (in database but not in new data)
    const jobsToRemove = existingJobs.filter(job => job.jobID && !newJobIDs.has(job.jobID));
    const removedJobIDs = jobsToRemove.map(job => job.jobID).filter(Boolean);

    // Remove old jobs
    const validRemovedJobIDs = removedJobIDs.filter((id): id is string => id !== null);
    if (validRemovedJobIDs.length > 0) {
      await storage.deleteJobPostingsByJobIDs(validRemovedJobIDs);
    }

    // Find jobs to add (in new data but not in database)
    const jobsToAdd = enrichedJobs.filter(job => !existingJobIDs.has(job.data.jobID));

    // Add new jobs
    for (const job of jobsToAdd) {
      const lat = parseFloat(job.latitude || '0');
      const lng = parseFloat(job.longitude || '0');
      const locationPoint = lat !== 0 && lng !== 0 ? `POINT (${lng} ${lat})` : null;

      await storage.createJobPosting({
        title: job.data.title,
        description: job.data.description || null,
        full_text: job.data.full_text || null,
        url: job.data.externalPath,
        company_name: job.data.company || null,
        brand: job.data.brand || null,
        functional_area: job.data.businessArea || null,
        work_type: job.data.workType || null,
        location_city: job.city,
        location_state: job.state,
        state_abbrev: this.getStateAbbreviation(job.state),
        zip_code: job.data.zipCode || null,
        country: job.country,
        latitude: job.latitude,
        longitude: job.longitude,
        location_point: locationPoint,
        job_details_json: JSON.stringify({
          businessArea: job.data.businessArea,
          lastDayToApply: job.data.lastDayToApply,
          source: 'algolia'
        }),
        status: "Active",
        is_expired: false,
        jobID: job.data.jobID,
        lastDayToApply: job.data.lastDayToApply ? new Date(job.data.lastDayToApply) : null,
        businessArea: job.data.businessArea,
      });
    }

    return {
      newJobs: jobsToAdd.length,
      removedJobs: removedJobIDs.length
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
      'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
    };
    return stateMap[stateName] || stateName.substring(0, 2).toUpperCase();
  }
}

export const pipelineService = new PipelineService();
