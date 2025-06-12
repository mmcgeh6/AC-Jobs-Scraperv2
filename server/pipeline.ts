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
          
          console.log('🔍 Enriched Job Structure:', JSON.stringify({
            jobID: String(job.data.jobID),
            originalCity: job.data.city,
            aiCity: aiResult.city,
            aiState: aiResult.state,
            aiCountry: aiResult.country,
            coordinates: coordinates,
            finalJobStructure: {
              city: enrichedJob.city,
              state: enrichedJob.state,
              country: enrichedJob.country
            }
          }, null, 2));
          
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
        console.log(`Fetching page ${page + 1} of ${totalPages}...`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const response = await fetch(`https://${APP_ID}.algolia.net/1/indexes/${INDEX_NAME}/query`, {
          method: 'POST',
          headers: {
            'X-Algolia-API-Key': API_KEY,
            'X-Algolia-Application-Id': APP_ID,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            params: `filters=data.country:"United States"&hitsPerPage=100&page=${page}`
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

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

    const prompt = `You are a US geography expert specializing in location standardization. Your task is to extract city, state, and country from job data, with MANDATORY state identification for US locations.

ABSOLUTE REQUIREMENTS:
1. For ANY US location, you MUST provide the state name - this is non-negotiable
2. Use your geographic knowledge to identify which state each city belongs to
3. Return full state names (e.g., "Texas", "California", "New York")
4. Never leave the state field empty for US locations

SPECIFIC EXAMPLES:
- Input: "Michigan City, United States" → Output: {"city": "Michigan City", "state": "Indiana", "country": "United States"}
- Input: "Houston, United States" → Output: {"city": "Houston", "state": "Texas", "country": "United States"}
- Input: "Charlotte, United States" → Output: {"city": "Charlotte", "state": "North Carolina", "country": "United States"}

JOB DATA TO PROCESS:
City: ${job.data.city}
Country: ${job.data.country}
Job Title: ${job.data.title}
URL: ${job.data.externalPath}

REQUIRED OUTPUT FORMAT (state field MUST be populated for US locations):
{
  "city": "standardized city name",
  "state": "full state name - REQUIRED for US",
  "country": "country name"
}`;

    console.log('🤖 AI Processing Request for Job:', job.data.jobID);
    console.log('Raw Input Data:', JSON.stringify({
      city: job.data.city,
      country: job.data.country,
      title: job.data.title,
      url: job.data.externalPath
    }, null, 2));

    try {
      const requestBody = {
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 4096
      };

      console.log('📤 Sending to Azure OpenAI:', JSON.stringify(requestBody, null, 2));

      const response = await fetch(AZURE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': API_KEY,
        },
        body: JSON.stringify(requestBody)
      });

      console.log('🌐 Azure OpenAI Response Status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('🚨 Azure OpenAI Error Response:', errorText);
        throw new Error(`Azure OpenAI API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('📥 Azure OpenAI Raw Response:', JSON.stringify(result, null, 2));
      
      const content = result.choices[0]?.message?.content;
      console.log('📝 AI Generated Content:', content);
      
      try {
        const parsed = JSON.parse(content);
        console.log('✅ Successfully Parsed AI Result:', JSON.stringify(parsed, null, 2));
        
        // Ensure state is properly extracted for US locations
        let finalState = parsed.state || '';
        
        // If state is missing but country is US, try to infer from city
        if (!finalState && (parsed.country === 'United States' || job.data.country === 'United States')) {
          const cityName = parsed.city || job.data.city;
          finalState = this.inferStateFromCity(cityName);
        }

        const finalResult = {
          city: parsed.city || job.data.city,
          state: finalState,
          country: parsed.country || job.data.country
        };
        console.log('🎯 Final AI Processing Result:', JSON.stringify(finalResult, null, 2));
        
        return finalResult;
      } catch (parseError) {
        console.error('🚨 JSON Parsing Failed:', parseError);
        console.log('⚠️ Using fallback for JSON parse error');
        return {
          city: job.data.city,
          state: '',
          country: job.data.country
        };
      }
    } catch (error) {
      console.error('🚨 AI processing error:', error);
      console.log('⚠️ Using fallback for processing error');
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
    console.log('💾 Starting database synchronization...');
    console.log('Total enriched jobs to sync:', enrichedJobs.length);
    console.log('Sample enriched job structure:', JSON.stringify(enrichedJobs[0], null, 2));

    const existingJobs = await storage.getAllJobPostings();
    console.log('📊 Existing jobs in database:', existingJobs.length);
    console.log('Sample existing job:', existingJobs[0] ? JSON.stringify(existingJobs[0], null, 2) : 'No existing jobs');
    
    const existingJobIDs = new Set(existingJobs.map(job => job.jobID).filter(Boolean));
    const newJobIDs = new Set(enrichedJobs.map(job => String(job.data.jobID)));
    console.log('Existing job IDs count:', existingJobIDs.size);
    console.log('New job IDs count:', newJobIDs.size);

    // Find jobs to remove (in database but not in new data)
    const jobsToRemove = existingJobs.filter(job => job.jobID && !newJobIDs.has(String(job.jobID)));
    const removedJobIDs = jobsToRemove.map(job => job.jobID).filter(Boolean);
    console.log('🗑️ Jobs to remove:', removedJobIDs.length);

    // Remove old jobs
    const validRemovedJobIDs = removedJobIDs.filter((id): id is string => id !== null);
    if (validRemovedJobIDs.length > 0) {
      console.log('Removing job IDs:', validRemovedJobIDs);
      await storage.deleteJobPostingsByJobIDs(validRemovedJobIDs);
      console.log('✅ Successfully removed old jobs');
    }

    // Find jobs to add (in new data but not in database)
    const jobsToAdd = enrichedJobs.filter(job => !existingJobIDs.has(String(job.data.jobID)));
    console.log('🆕 New jobs to add:', jobsToAdd.length);

    // Add new jobs
    for (let i = 0; i < jobsToAdd.length; i++) {
      const job = jobsToAdd[i];
      console.log(`💾 Creating job ${i+1}/${jobsToAdd.length}: ${job.data.jobID}`);
      
      const lat = parseFloat(job.latitude || '0');
      const lng = parseFloat(job.longitude || '0');
      const locationPoint = lat !== 0 && lng !== 0 ? `POINT (${lng} ${lat})` : null;

      const jobData = {
        title: job.data.title,
        description: job.data.description || null,
        full_text: job.data.full_text || null,
        url: job.data.externalPath,
        company_name: job.data.company || null,
        brand: Array.isArray(job.data.brand) ? job.data.brand.join(', ') : job.data.brand || null,
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
        jobID: String(job.data.jobID),
        lastDayToApply: job.data.lastDayToApply ? new Date(job.data.lastDayToApply) : null,
        businessArea: job.data.businessArea,
      };

      console.log('Job data to insert:', JSON.stringify(jobData, null, 2));

      try {
        console.log('📤 Attempting to insert job into database...');
        const createdJob = await storage.createJobPosting(jobData);
        console.log('✅ Successfully created job:', createdJob.jobID || createdJob.id);
      } catch (error: any) {
        console.error(`🚨 Failed to create job ${job.data.jobID}:`, error.message);
        console.error('🔍 Full error details:', JSON.stringify(error, null, 2));
        console.error('📋 Job data that failed:', JSON.stringify(jobData, null, 2));
        
        // Log specific validation issues
        if (error.code === 'EPARAM') {
          console.error('💡 Parameter validation error - checking data types...');
          Object.entries(jobData).forEach(([key, value]) => {
            console.error(`  ${key}: ${typeof value} = ${value}`);
          });
        }
      }
    }

    console.log('💾 Database sync completed');
    console.log(`📊 Final stats - Added: ${jobsToAdd.length}, Removed: ${removedJobIDs.length}`);

    return {
      newJobs: jobsToAdd.length,
      removedJobs: removedJobIDs.length
    };
  }

  getProcessedJobs(): any[] {
    return this.processedJobs;
  }

  private inferStateFromCity(cityName: string): string {
    // Common city-to-state mappings for major cities
    const cityStateMap: { [key: string]: string } = {
      'Michigan City': 'Indiana',
      'Houston': 'Texas',
      'Charlotte': 'North Carolina',
      'Austin': 'Texas',
      'Dallas': 'Texas',
      'Phoenix': 'Arizona',
      'Atlanta': 'Georgia',
      'Chicago': 'Illinois',
      'New York': 'New York',
      'Los Angeles': 'California',
      'San Francisco': 'California',
      'Seattle': 'Washington',
      'Miami': 'Florida',
      'Boston': 'Massachusetts',
      'Denver': 'Colorado',
      'Portland': 'Oregon',
      'Buffalo': 'New York',
      'Nashville': 'Tennessee',
      'Memphis': 'Tennessee',
      'Detroit': 'Michigan',
      'Minneapolis': 'Minnesota',
      'Kansas City': 'Missouri',
      'San Antonio': 'Texas',
      'Philadelphia': 'Pennsylvania',
      'San Diego': 'California',
      'Las Vegas': 'Nevada',
      'Cleveland': 'Ohio',
      'Columbus': 'Ohio',
      'Cincinnati': 'Ohio',
      'Pittsburgh': 'Pennsylvania',
      'Baltimore': 'Maryland',
      'Washington': 'District of Columbia',
      'Richmond': 'Virginia',
      'Norfolk': 'Virginia',
      'Raleigh': 'North Carolina',
      'Jacksonville': 'Florida',
      'Tampa': 'Florida',
      'Orlando': 'Florida',
      'New Orleans': 'Louisiana',
      'Birmingham': 'Alabama',
      'Louisville': 'Kentucky',
      'Indianapolis': 'Indiana',
      'Milwaukee': 'Wisconsin',
      'Omaha': 'Nebraska',
      'Salt Lake City': 'Utah',
      'Albuquerque': 'New Mexico',
      'Tucson': 'Arizona',
      'Fresno': 'California',
      'Sacramento': 'California',
      'Long Beach': 'California',
      'Mesa': 'Arizona',
      'Virginia Beach': 'Virginia',
      'Colorado Springs': 'Colorado',
      'Reno': 'Nevada'
    };

    const normalizedCity = cityName.replace(/,.*$/, '').trim();
    return cityStateMap[normalizedCity] || '';
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
