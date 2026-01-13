# Account Statement Comparator

A React-based tool to clean, standardize, and compare two account statements from Excel files.

## Features

- Upload two Excel/CSV account statements
- Automatically detect and map columns (Date, Description, Amount, Balance, Reference)
- Clean and standardize data formats
- Sort transactions chronologically
- Compare statements with intelligent matching (description + amount, then amount-only fallback)
- Identify discrepancies, missing transactions, and duplicates
- Download cleaned statements
- AI-powered analysis using Claude API

## Installation
```bash
npm install
```

## Required Dependencies
```bash
npm install react lucide-react xlsx
```

## Usage

1. Upload two account statement files (Excel or CSV)
2. Click "Clean & Standardize" to process both files
3. Review the cleaned data preview
4. Click "Compare Statements" to see detailed analysis
5. Download cleaned files if needed

## How It Works

### Cleaning Process
- Detects column names automatically
- Standardizes formats (dates, amounts, descriptions)
- Removes currency symbols
- Sorts by date
- Preserves all original data

### Comparison Process
- **Pass 1**: Matches by Date + Amount + Description
- **Pass 2**: Matches by Date + Amount only (for description mismatches)
- Analyzes debit/credit classification
- Identifies missing or duplicate transactions

## Technologies Used

- React
- Claude API (Anthropic)
- SheetJS (xlsx)
- Lucide React (icons)
- Tailwind CSS

## License

MIT
