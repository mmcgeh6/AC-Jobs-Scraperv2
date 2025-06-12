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
    [key: string]: any; // Allow other properties
  };
  [key: string]: any; // Allow other properties
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
    if (this.currentExecutionId) {
      await storage.createActivityLog({
        message,
        level,
        executionId: this.currentExecutionId,
      });
    }
  }

  async executePipeline(batchSize: number = 100): Promise<void> {
    this.processedJobs = [];
    const execution = await storage.createPipelineExecution({
      status: 'running',
      startTime: new Date(),
      currentStep: 'Initializing...',
    });

    this.currentExecutionId = execution.id;

    try {
      await this.logActivity('Started manual pipeline execution', 'info');
      await this.sendProgress({ type: 'status', status: 'running', step: 'Initializing...', progress: 0 });

      // Step 1: Fetch jobs
      await this.sendProgress({ type: 'status', step: 'Fetching jobs from Algolia...', progress: 10 });
      const allJobs = await this.fetchJobsFromAlgolia();
      const jobs = allJobs.slice(0, batchSize);
      
      await storage.updatePipelineExecution(execution.id, { totalJobs: jobs.length, currentStep: `Fetched ${jobs.length} jobs` });
      await this.logActivity(`Fetched ${jobs.length} job listings`, 'success');
      await this.sendProgress({ type: 'status', step: `Fetched ${jobs.length} jobs`, progress: 25, totalJobs: jobs.length });

      // Step 2: Enrich jobs
      const enrichedJobs = [];
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        try {
          const aiResult = await this.processLocationWithAI(job);
          const coordinates = await this.getCoordinates(aiResult);
          
          const enrichedJob = { ...job, ...aiResult, ...coordinates };
          enrichedJobs.push(enrichedJob);
          
          this.processedJobs.push({ originalData: job.data, aiProcessed: aiResult, coordinates, timestamp: new Date().toISOString() });

          const progress = 25 + ((i + 1) / jobs.length) * 50;
          await storage.updatePipelineExecution(execution.id, { processedJobs: i + 1, currentStep: `Processing locations (${i + 1}/${jobs.length})` });
          await this.sendProgress({ type: 'status', step: `Processing locations (${i + 1}/${jobs.length})`, progress: Math.round(progress), processedJobs: i + 1 });
          
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error: any) {
          await this.logActivity(`Error processing job ${job.data.jobID}: ${error.message}`, 'error');
        }
      }

      // Step 3: Synchronize database
      await this.sendProgress({ type: 'status', step: 'Synchronizing with database...', progress: 80 });
      const { newJobs, removedJobs } = await this.synchronizeDatabase(enrichedJobs);

      await storage.updatePipelineExecution(execution.id, { status: 'completed', endTime: new Date(), newJobs, removedJobs, currentStep: 'Completed successfully' });
      await this.logActivity('Pipeline completed successfully', 'success');
      await this.sendProgress({ type: 'complete', progress: 100, newJobs, removedJobs });

    } catch (error: any) {
      await storage.updatePipelineExecution(execution.id, { status: 'failed', endTime: new Date(), errorMessage: error.message, currentStep: 'Failed' });
      await this.logActivity(`Pipeline failed: ${error.message}`, 'error');
      await this.sendProgress({ type: 'error', message: error.message });
      console.error("Pipeline execution failed:", error);
    }
  }

  private async fetchJobsFromAlgolia(): Promise<AlgoliaJob[]> {
    const APP_ID = 'LXMKS8ARA3';
    const API_KEY = '933a2398c301661168ab0f240713ec3d';
    const INDEX_NAME = 'GROUP_EN_dateDesc';
    const allJobs: AlgoliaJob[] = [];
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const response = await fetch(`https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX_NAME}/query`, {
        method: 'POST',
        headers: { 'X-Algolia-API-Key': API_KEY, 'X-Algolia-Application-Id': APP_ID, 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: `filters=data.country:"United States"&hitsPerPage=100&page=${page}` }),
      });
      if (!response.ok) throw new Error(`Algolia API error: ${response.statusText}`);
      
      const data = await response.json() as AlgoliaResponse;
      allJobs.push(...data.hits);
      if (page === 0) totalPages = data.nbPages;
      page++;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return allJobs;
  }

  private async processLocationWithAI(job: AlgoliaJob): Promise<AILocationResponse> {
    const AZURE_ENDPOINT = "https://ai-acgenaidevtest540461206109.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2025-01-01-preview";
    const API_KEY = process.env.AZURE_OPENAI_KEY || "3fcde4edd6fd43b4968a8e0e716c61e5";
    
    const prompt = `Extract city, state (full name), and country for the US location from the following job data. For US locations, providing the state is mandatory.
      City: ${job.data.city}, Country: ${job.data.country}, Title: ${job.data.title}, URL: ${job.data.externalPath}
      Respond in JSON format: {"city": "...", "state": "...", "country": "..."}`;

    const response = await fetch(AZURE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 150 }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure OpenAI API error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    const content = result.choices[0]?.message?.content;
    try {
      return JSON.parse(content);
    } catch {
      return { city: job.data.city, state: '', country: job.data.country };
    }
  }

  private async getCoordinates(location: AILocationResponse): Promise<{ latitude: string; longitude: string }> {
    const API_KEY = process.env.GOOGLE_GEOCODING_API_KEY || "AIzaSyA3MC5XeDbmLA0Mgv0U7CJTycwQlEVaCzc";
    const address = `${location.city}, ${location.state}, ${location.country}`;
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`);
    
    if (!response.ok) return { latitude: '0', longitude: '0' };
    
    const result: GeocodingResponse = await response.json();
    if (result.status === 'OK' && result.results.length > 0) {
      const { lat, lng } = result.results[0].geometry.location;
      return { latitude: lat.toString(), longitude: lng.toString() };
    }
    return { latitude: '0', longitude: '0' };
  }

  private async synchronizeDatabase(enrichedJobs: any[]): Promise<{ newJobs: number; removedJobs: number }> {
    console.log('🔄 Starting database synchronization with', enrichedJobs.length, 'enriched jobs');
    
    const existingJobs = await storage.getAllJobPostings();
    console.log('📊 Found', existingJobs.length, 'existing jobs in database');
    
    const existingJobIDs = new Set(existingJobs.map(j => j.jobID).filter(Boolean));
    const newJobIDs = new Set(enrichedJobs.map(j => String(j.data.jobID)));
    
    console.log('🔍 Existing job IDs:', Array.from(existingJobIDs));
    console.log('🔍 New job IDs:', Array.from(newJobIDs));

    const jobsToRemove = existingJobs.filter(j => j.jobID && !newJobIDs.has(j.jobID));
    const jobsToAdd = enrichedJobs.filter(j => !existingJobIDs.has(String(j.data.jobID)));

    console.log('🗑️ Jobs to remove:', jobsToRemove.length);
    console.log('🆕 Jobs to add:', jobsToAdd.length);

    if (jobsToRemove.length > 0) {
      console.log('Removing old jobs...');
      const jobIdsToRemove = jobsToRemove.map(j => j.jobID!).filter(Boolean);
      await storage.deleteJobPostingsByJobIDs(jobIdsToRemove);
    }

    for (const job of jobsToAdd) {
      try {
        console.log(`💾 Processing job ${job.data.jobID} for insertion...`);
        const lat = parseFloat(job.latitude || '0');
        const lng = parseFloat(job.longitude || '0');
        const locationPoint = (lat !== 0 && lng !== 0 && !isNaN(lat) && !isNaN(lng)) ? `POINT(${lng} ${lat})` : null;
        
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
          job_details_json: JSON.stringify({ ...job.data }),
          status: "Active",
          is_expired: false,
          jobID: String(job.data.jobID),
          lastDayToApply: job.data.lastDayToApply ? new Date(job.data.lastDayToApply) : null,
          businessArea: job.data.businessArea,
        };
        
        console.log(`🔧 About to call storage.createJobPosting for job ${job.data.jobID}`);
        await storage.createJobPosting(jobData);
        console.log(`✅ Successfully inserted job ${job.data.jobID}`);
      } catch (error) {
        console.error(`❌ Failed to insert job ${job.data.jobID}:`, error);
        await this.logActivity(`Failed to insert job ${job.data.jobID}: ${(error as Error).message}`, 'error');
      }
    }

    console.log('💾 Database synchronization completed');
    return { newJobs: jobsToAdd.length, removedJobs: jobsToRemove.length };
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
    return stateMap[stateName] || '';
  }
}

export const pipelineService = new PipelineService();