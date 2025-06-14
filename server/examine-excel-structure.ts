import XLSX from 'xlsx';

async function examineExcelStructure() {
  try {
    console.log('📋 Examining Excel file structure...');
    
    const filePath = 'attached_assets/US Zips with Lat_Long_1749766376077.xlsx';
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 Total records: ${data.length}`);
    console.log('📋 First 3 records:');
    console.log(JSON.stringify(data.slice(0, 3), null, 2));
    
    if (data.length > 0) {
      console.log('\n📋 Available columns:');
      console.log(Object.keys(data[0]));
    }
    
  } catch (error) {
    console.error('❌ Failed to examine Excel file:', error);
  }
}

examineExcelStructure();