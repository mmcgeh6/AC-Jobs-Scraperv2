import XLSX from 'xlsx';

interface ZipcodeRecord {
  postal_code: string;
  city: string;
  state: string;
  state_abbrev: string;
  latitude: number;
  longitude: number;
}

class ZipcodeLookup {
  private zipcodes: Map<string, ZipcodeRecord[]> = new Map();
  private loaded = false;

  async loadZipcodes(): Promise<void> {
    if (this.loaded) return;

    try {
      console.log('📋 Loading US zipcode database...');
      
      const filePath = 'attached_assets/US Zips with Lat_Long_1749766376077.xlsx';
      const workbook = XLSX.readFile(filePath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet) as any[];
      
      for (const row of data) {
        const postalCode = String(row['postal code'] || '').trim();
        const city = String(row['City'] || '').trim().toLowerCase();
        const state = String(row['State'] || '').trim();
        const stateAbbrev = String(row['State Abbrev'] || '').trim().toUpperCase();
        const latitude = parseFloat(row['latitude']) || 0;
        const longitude = parseFloat(row['longitude']) || 0;
        
        if (postalCode && city && stateAbbrev) {
          const record: ZipcodeRecord = {
            postal_code: postalCode,
            city: row['City'], // Keep original case
            state,
            state_abbrev: stateAbbrev,
            latitude,
            longitude
          };
          
          // Create lookup keys for city+state combinations
          const keys = [
            `${city}|${stateAbbrev}`,
            `${city}|${state.toLowerCase()}`
          ];
          
          for (const key of keys) {
            if (!this.zipcodes.has(key)) {
              this.zipcodes.set(key, []);
            }
            this.zipcodes.get(key)!.push(record);
          }
        }
      }
      
      this.loaded = true;
      console.log(`✅ Loaded ${data.length} zipcode records into lookup system`);
      
    } catch (error) {
      console.error('Failed to load zipcode database:', error);
    }
  }

  lookupZipcode(city: string, state: string): string {
    if (!this.loaded) return '';
    
    const cityLower = city.toLowerCase();
    const stateLower = state.toLowerCase();
    
    // Try different lookup combinations
    const lookupKeys = [
      `${cityLower}|${state.toUpperCase()}`,
      `${cityLower}|${stateLower}`,
      `${cityLower}|${this.getStateAbbreviation(state)}`
    ];
    
    for (const key of lookupKeys) {
      const records = this.zipcodes.get(key);
      if (records && records.length > 0) {
        // Return the first zipcode found
        return records[0].postal_code;
      }
    }
    
    return '';
  }

  private getStateAbbreviation(stateName: string): string {
    const stateMap: { [key: string]: string } = {
      'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
      'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
      'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
      'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
      'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
      'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
      'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
      'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
      'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
      'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
    };
    
    return stateMap[stateName.toLowerCase()] || stateName.toUpperCase();
  }
}

export const zipcodeLookup = new ZipcodeLookup();