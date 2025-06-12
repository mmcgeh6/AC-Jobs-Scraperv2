import XLSX from 'xlsx';

async function examineZipcodeFile() {
  try {
    const filePath = 'attached_assets/US Zips with Lat_Long_1749766376077.xlsx';
    
    // Read the Excel file
    const workbook = XLSX.readFile(filePath);
    
    // Get the first sheet name
    const sheetName = workbook.SheetNames[0];
    console.log(`Sheet name: ${sheetName}`);
    
    // Convert to JSON
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`Total rows: ${data.length}`);
    console.log(`Columns: ${Object.keys(data[0] || {}).join(', ')}`);
    
    // Show first 5 rows
    console.log('\nFirst 5 rows:');
    data.slice(0, 5).forEach((row, index) => {
      console.log(`Row ${index + 1}:`, row);
    });
    
  } catch (error) {
    console.error('Error reading Excel file:', error);
  }
}

examineZipcodeFile();