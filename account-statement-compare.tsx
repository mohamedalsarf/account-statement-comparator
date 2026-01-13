import React, { useState } from 'react';
import { Upload, AlertCircle, CheckCircle, FileText, Wand2, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

const AccountStatementComparator = () => {
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);
  const [data1, setData1] = useState(null);
  const [data2, setData2] = useState(null);
  const [cleaned1, setCleaned1] = useState(null);
  const [cleaned2, setCleaned2] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('upload'); // upload, clean, compare

  const parseExcelFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { raw: false });
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const handleFileUpload = async (file, setterFile, setterData) => {
    if (!file) return;
    
    try {
      setterFile(file);
      const parsed = await parseExcelFile(file);
      setterData(parsed);
    } catch (error) {
      alert('Error parsing file: ' + error.message);
    }
  };

  const cleanStatements = async () => {
    if (!data1 || !data2) {
      alert('Please upload both files first');
      return;
    }

    setLoading(true);
    setStep('clean');
    
    try {
      // Get column info from both statements
      const columns1 = data1.length > 0 ? Object.keys(data1[0]) : [];
      const columns2 = data2.length > 0 ? Object.keys(data2[0]) : [];

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8000,
          messages: [{
            role: 'user',
            content: `I need you to clean and standardize two account statements for comparison.

Statement 1 columns: ${JSON.stringify(columns1)}
Statement 1 sample (first 5 rows):
${JSON.stringify(data1.slice(0, 5), null, 2)}

Statement 2 columns: ${JSON.stringify(columns2)}
Statement 2 sample (first 5 rows):
${JSON.stringify(data2.slice(0, 5), null, 2)}

Please analyze both statements and return ONLY a JSON object (no markdown, no backticks) with:
{
  "mappings": {
    "statement1": {
      "dateColumn": "detected column name for date",
      "descriptionColumn": "detected column name for description/transaction details",
      "amountColumn": "detected column name for amount/debit/credit",
      "balanceColumn": "detected column name for balance (if exists)",
      "referenceColumn": "detected column name for reference/transaction id (if exists)"
    },
    "statement2": {
      "dateColumn": "...",
      "descriptionColumn": "...",
      "amountColumn": "...",
      "balanceColumn": "...",
      "referenceColumn": "..."
    }
  },
  "standardColumns": ["Date", "Description", "Amount", "Balance", "Reference"],
  "cleaningRules": [
    "rule 1: e.g., convert dates to YYYY-MM-DD format",
    "rule 2: e.g., remove currency symbols from amounts",
    "rule 3: e.g., trim whitespace from descriptions"
  ],
  "dataIssues": [
    "issue 1: e.g., missing values in column X",
    "issue 2: e.g., inconsistent date formats"
  ]
}`
          }]
        })
      });

      const result = await response.json();
      const content = result.content.find(c => c.type === 'text')?.text || '';
      const cleanContent = content.replace(/```json|```/g, '').trim();
      const mappingData = JSON.parse(cleanContent);

      // Now clean the actual data
      const cleaned1Data = cleanData(data1, mappingData.mappings.statement1);
      const cleaned2Data = cleanData(data2, mappingData.mappings.statement2);

      setCleaned1({ data: cleaned1Data, mapping: mappingData.mappings.statement1, rules: mappingData.cleaningRules, issues: mappingData.dataIssues });
      setCleaned2({ data: cleaned2Data, mapping: mappingData.mappings.statement2, rules: mappingData.cleaningRules, issues: mappingData.dataIssues });
      
    } catch (error) {
      alert('Error cleaning statements: ' + error.message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const cleanData = (data, mapping) => {
    return data.map(row => {
      // Start with all original data
      const cleaned = { ...row };
      
      // Create standardized columns while keeping originals
      cleaned.Date = row[mapping.dateColumn] || '';
      cleaned.Description = row[mapping.descriptionColumn] || '';
      cleaned.Amount = row[mapping.amountColumn] || '';
      cleaned.Balance = row[mapping.balanceColumn] || '';
      cleaned.Reference = row[mapping.referenceColumn] || '';

      // Clean amount - remove currency symbols and keep original
      if (cleaned.Amount) {
        const originalAmount = cleaned.Amount;
        cleaned.Amount = cleaned.Amount.toString().replace(/[^0-9.-]/g, '');
        cleaned.OriginalAmount = originalAmount;
      }

      return cleaned;
    }).sort((a, b) => {
      // Sort by date
      try {
        const date1 = new Date(a.Date);
        const date2 = new Date(b.Date);
        if (isNaN(date1) || isNaN(date2)) return 0;
        return date1 - date2;
      } catch (e) {
        return 0;
      }
    });
  };

  const compareStatements = async () => {
    if (!cleaned1 || !cleaned2) {
      alert('Please clean the statements first');
      return;
    }

    setLoading(true);
    setStep('compare');
    
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: `Compare these cleaned account statements using a two-pass matching strategy:

MATCHING STRATEGY:
1. First Pass: Match transactions by Date + Amount + Description (exact or similar description match)
2. Second Pass: For unmatched transactions, match by Date + Amount only (ignore description)

When analyzing amounts, determine if they are debits or credits based on:
- The description context (words like "payment", "withdrawal", "debit" vs "deposit", "credit", "transfer in")
- The sign of the amount (negative typically = debit, positive = credit)
- Compare debits to debits and credits to credits

Statement 1 (${cleaned1.data.length} transactions):
${JSON.stringify(cleaned1.data.slice(0, 50), null, 2)}

Statement 2 (${cleaned2.data.length} transactions):
${JSON.stringify(cleaned2.data.slice(0, 50), null, 2)}

Return ONLY a JSON object (no markdown, no backticks):
{
  "summary": {
    "totalTransactions1": number,
    "totalTransactions2": number,
    "matchedWithDescription": number,
    "matchedAmountOnly": number,
    "uniqueToStatement1": number,
    "uniqueToStatement2": number,
    "potentialDuplicates": number
  },
  "matchingDetails": {
    "perfectMatches": number,
    "descriptionMismatches": number,
    "amountMismatches": number
  },
  "insights": ["insight 1", "insight 2"],
  "potentialIssues": [
    {
      "type": "missing" | "duplicate" | "description_mismatch" | "amount_difference" | "debit_credit_mismatch",
      "description": "detailed description",
      "severity": "high" | "medium" | "low",
      "details": "specific transaction info (date, amount, descriptions from both statements)",
      "transaction1": "description from statement 1 if applicable",
      "transaction2": "description from statement 2 if applicable"
    }
  ],
  "recommendations": ["recommendation 1"]
}`
          }]
        })
      });

      const result = await response.json();
      const content = result.content.find(c => c.type === 'text')?.text || '';
      const cleanContent = content.replace(/```json|```/g, '').trim();
      const analysis = JSON.parse(cleanContent);
      
      setComparison(analysis);
    } catch (error) {
      alert('Error comparing statements: ' + error.message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const downloadCleanedData = (cleanedData, filename) => {
    const ws = XLSX.utils.json_to_sheet(cleanedData.data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cleaned Statement');
    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center gap-3">
            <FileText className="text-indigo-600" />
            Account Statement Cleaner & Comparator
          </h1>
          <p className="text-gray-600 mb-8">Upload, clean, standardize, and compare account statements</p>

          {/* Progress Steps */}
          <div className="flex items-center justify-center mb-8 gap-4">
            <div className={`flex items-center gap-2 ${step === 'upload' ? 'text-indigo-600 font-semibold' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'upload' ? 'bg-indigo-600 text-white' : 'bg-gray-300'}`}>1</div>
              <span>Upload</span>
            </div>
            <div className="w-16 h-0.5 bg-gray-300"></div>
            <div className={`flex items-center gap-2 ${step === 'clean' ? 'text-indigo-600 font-semibold' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'clean' ? 'bg-indigo-600 text-white' : 'bg-gray-300'}`}>2</div>
              <span>Clean</span>
            </div>
            <div className="w-16 h-0.5 bg-gray-300"></div>
            <div className={`flex items-center gap-2 ${step === 'compare' ? 'text-indigo-600 font-semibold' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'compare' ? 'bg-indigo-600 text-white' : 'bg-gray-300'}`}>3</div>
              <span>Compare</span>
            </div>
          </div>

          {/* Upload Section */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
              <label className="cursor-pointer block">
                <div className="flex flex-col items-center">
                  <Upload className="w-12 h-12 text-gray-400 mb-3" />
                  <span className="text-sm font-medium text-gray-700 mb-2">Statement 1</span>
                  <span className="text-xs text-gray-500 text-center">
                    {file1 ? file1.name : 'Click to upload Excel file'}
                  </span>
                  {data1 && (
                    <span className="text-xs text-green-600 mt-2">
                      ✓ {data1.length} rows loaded
                    </span>
                  )}
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e.target.files[0], setFile1, setData1)}
                />
              </label>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-indigo-400 transition-colors">
              <label className="cursor-pointer block">
                <div className="flex flex-col items-center">
                  <Upload className="w-12 h-12 text-gray-400 mb-3" />
                  <span className="text-sm font-medium text-gray-700 mb-2">Statement 2</span>
                  <span className="text-xs text-gray-500 text-center">
                    {file2 ? file2.name : 'Click to upload Excel file'}
                  </span>
                  {data2 && (
                    <span className="text-xs text-green-600 mt-2">
                      ✓ {data2.length} rows loaded
                    </span>
                  )}
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e.target.files[0], setFile2, setData2)}
                />
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 mb-8">
            <button
              onClick={cleanStatements}
              disabled={!data1 || !data2 || loading}
              className="flex-1 bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              <Wand2 className="w-5 h-5" />
              {loading && step === 'clean' ? 'Cleaning & Standardizing...' : 'Clean & Standardize'}
            </button>

            {cleaned1 && cleaned2 && (
              <button
                onClick={compareStatements}
                disabled={loading}
                className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {loading && step === 'compare' ? 'Comparing...' : 'Compare Statements'}
              </button>
            )}
          </div>

          {/* Cleaned Data Preview */}
          {cleaned1 && cleaned2 && (
            <div className="mb-8 space-y-6">
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <CheckCircle className="text-green-600" />
                    Statements Cleaned Successfully
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => downloadCleanedData(cleaned1, 'Statement1_Cleaned.xlsx')}
                      className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download #1
                    </button>
                    <button
                      onClick={() => downloadCleanedData(cleaned2, 'Statement2_Cleaned.xlsx')}
                      className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download #2
                    </button>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div className="bg-white rounded p-4">
                    <h3 className="font-semibold text-gray-800 mb-2">Statement 1</h3>
                    <div className="text-sm text-gray-600 space-y-1">
                      <div>Rows: {cleaned1.data.length}</div>
                      <div>Sorted by date (oldest to newest)</div>
                    </div>
                  </div>
                  <div className="bg-white rounded p-4">
                    <h3 className="font-semibold text-gray-800 mb-2">Statement 2</h3>
                    <div className="text-sm text-gray-600 space-y-1">
                      <div>Rows: {cleaned2.data.length}</div>
                      <div>Sorted by date (oldest to newest)</div>
                    </div>
                  </div>
                </div>

                {cleaned1.rules && (
                  <div className="bg-white rounded p-4">
                    <h3 className="font-semibold text-gray-800 mb-2">Applied Cleaning Rules:</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                      {cleaned1.rules.map((rule, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-green-600">✓</span>
                          <span>{rule}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Preview cleaned data */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">Statement 1 Preview (First 5)</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="p-2 text-left">Date</th>
                          <th className="p-2 text-left">Description</th>
                          <th className="p-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cleaned1.data.slice(0, 5).map((row, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="p-2">{row.Date}</td>
                            <td className="p-2 truncate max-w-xs">{row.Description}</td>
                            <td className="p-2 text-right">{row.Amount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">Statement 2 Preview (First 5)</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="p-2 text-left">Date</th>
                          <th className="p-2 text-left">Description</th>
                          <th className="p-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cleaned2.data.slice(0, 5).map((row, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="p-2">{row.Date}</td>
                            <td className="p-2 truncate max-w-xs">{row.Description}</td>
                            <td className="p-2 text-right">{row.Amount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Comparison Results */}
          {comparison && (
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-lg p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4">Comparison Summary</h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-2xl font-bold text-indigo-600">
                      {comparison.summary.totalTransactions1}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Statement 1</div>
                  </div>
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-2xl font-bold text-indigo-600">
                      {comparison.summary.totalTransactions2}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Statement 2</div>
                  </div>
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {comparison.summary.matchingTransactions}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Matching</div>
                  </div>
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {comparison.summary.uniqueToStatement1}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Unique to 1</div>
                  </div>
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {comparison.summary.uniqueToStatement2}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Unique to 2</div>
                  </div>
                </div>
              </div>

              {comparison.potentialIssues && comparison.potentialIssues.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <AlertCircle className="text-orange-500" />
                    Potential Issues Found
                  </h2>
                  <div className="space-y-3">
                    {comparison.potentialIssues.map((issue, idx) => (
                      <div
                        key={idx}
                        className={`p-4 rounded-lg border-l-4 ${
                          issue.severity === 'high'
                            ? 'bg-red-50 border-red-500'
                            : issue.severity === 'medium'
                            ? 'bg-orange-50 border-orange-500'
                            : 'bg-yellow-50 border-yellow-500'
                        }`}
                      >
                        <div className="font-medium text-gray-800 capitalize mb-1">
                          {issue.type.replace(/_/g, ' ')} ({issue.severity} severity)
                        </div>
                        <div className="text-sm text-gray-700 mb-2">
                          {issue.description}
                        </div>
                        {issue.details && (
                          <div className="text-xs text-gray-600 bg-white bg-opacity-50 rounded p-2">
                            {issue.details}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {comparison.insights && comparison.insights.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <CheckCircle className="text-green-500" />
                    Key Insights
                  </h2>
                  <div className="space-y-2">
                    {comparison.insights.map((insight, idx) => (
                      <div key={idx} className="flex items-start gap-3 text-gray-700">
                        <span className="text-indigo-600 font-bold">•</span>
                        <span>{insight}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {comparison.recommendations && comparison.recommendations.length > 0 && (
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">Recommendations</h2>
                  <div className="space-y-2">
                    {comparison.recommendations.map((rec, idx) => (
                      <div key={idx} className="flex items-start gap-3 text-gray-700">
                        <span className="text-green-600 font-bold">{idx + 1}.</span>
                        <span>{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountStatementComparator;