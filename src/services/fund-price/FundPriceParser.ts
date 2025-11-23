import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import * as fs from 'fs';
import { logger } from '../../config/logger';
import { FundPriceData } from './FundPriceService';

/**
 * Parser for fund price CSV/Excel files
 *
 * Supported formats:
 * 1. Excel with 3 tabs (bid, mid, offer):
 *    Each tab: Date | XUMMF | XUBF | XUDEF | XUREF
 * 2. CSV/Excel rows (legacy):
 *    Date, Fund Code, Bid Price, Mid Price, Offer Price, NAV
 */
export class FundPriceParser {
  private static readonly FUND_CODES = ['XUMMF', 'XUBF', 'XUDEF', 'XUREF'];
  private static readonly SHEET_NAMES = ['bid', 'mid', 'offer'];

  /**
   * Parse fund price file (CSV or Excel)
   */
  static async parseFile(filePath: string): Promise<FundPriceData[]> {
    const extension = filePath.toLowerCase().split('.').pop();

    if (extension === 'csv') {
      return this.parseCSV(filePath);
    } else if (extension === 'xlsx' || extension === 'xls') {
      return this.parseExcel(filePath);
    } else {
      throw new Error('Unsupported file format. Please upload CSV or Excel file.');
    }
  }

  /**
   * Parse CSV file
   */
  private static async parseCSV(filePath: string): Promise<FundPriceData[]> {
    return new Promise((resolve, reject) => {
      const fileContent = fs.readFileSync(filePath, 'utf8');

      Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const prices = this.processRows(results.data);
            resolve(prices);
          } catch (error) {
            reject(error);
          }
        },
        error: (error: any) => {
          reject(new Error(`CSV parsing error: ${error.message}`));
        },
      });
    });
  }

  /**
   * Parse Excel file
   */
  private static async parseExcel(filePath: string): Promise<FundPriceData[]> {
    try {
      const workbook = XLSX.readFile(filePath);

      // Check if file uses new 3-tab format
      const hasThreeTabs = this.SHEET_NAMES.every(name =>
        workbook.SheetNames.some(sheetName => sheetName.toLowerCase() === name)
      );

      if (hasThreeTabs) {
        return this.parseThreeTabFormat(workbook);
      } else {
        // Fall back to legacy row format
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' });
        return this.processRows(data);
      }
    } catch (error: any) {
      throw new Error(`Excel parsing error: ${error.message}`);
    }
  }

  /**
   * Parse 3-tab format (bid, mid, offer tabs)
   */
  private static parseThreeTabFormat(workbook: XLSX.WorkBook): FundPriceData[] {
    // Find the sheet names (case-insensitive)
    const bidSheet = workbook.SheetNames.find(name => name.toLowerCase() === 'bid');
    const midSheet = workbook.SheetNames.find(name => name.toLowerCase() === 'mid');
    const offerSheet = workbook.SheetNames.find(name => name.toLowerCase() === 'offer');

    if (!bidSheet || !midSheet || !offerSheet) {
      throw new Error('Excel file must have sheets named: bid, mid, offer');
    }

    // Parse each sheet
    const bidData = XLSX.utils.sheet_to_json(workbook.Sheets[bidSheet], { raw: false, defval: '' });
    const midData = XLSX.utils.sheet_to_json(workbook.Sheets[midSheet], { raw: false, defval: '' });
    const offerData = XLSX.utils.sheet_to_json(workbook.Sheets[offerSheet], { raw: false, defval: '' });

    // Group prices by date and fund code
    const pricesMap = new Map<string, FundPriceData>();

    // Process bid prices
    bidData.forEach((row: any, index: number) => {
      const date = this.getDateFromRow(row);
      if (!date) {
        logger.warn(`Skipping bid row ${index + 2}: Invalid date`);
        return;
      }

      this.FUND_CODES.forEach(fundCode => {
        const priceValue = this.getFundPriceFromRow(row, fundCode);
        if (priceValue !== null) {
          const key = `${date.toISOString()}-${fundCode}`;
          const existing = pricesMap.get(key);
          pricesMap.set(key, {
            fundCode,
            priceDate: date,
            bidPrice: priceValue,
            midPrice: existing?.midPrice || 0,
            offerPrice: existing?.offerPrice || 0,
          });
        }
      });
    });

    // Process mid prices
    midData.forEach((row: any, index: number) => {
      const date = this.getDateFromRow(row);
      if (!date) {
        logger.warn(`Skipping mid row ${index + 2}: Invalid date`);
        return;
      }

      this.FUND_CODES.forEach(fundCode => {
        const priceValue = this.getFundPriceFromRow(row, fundCode);
        if (priceValue !== null) {
          const key = `${date.toISOString()}-${fundCode}`;
          const existing = pricesMap.get(key);
          if (existing) {
            existing.midPrice = priceValue;
          }
        }
      });
    });

    // Process offer prices
    offerData.forEach((row: any, index: number) => {
      const date = this.getDateFromRow(row);
      if (!date) {
        logger.warn(`Skipping offer row ${index + 2}: Invalid date`);
        return;
      }

      this.FUND_CODES.forEach(fundCode => {
        const priceValue = this.getFundPriceFromRow(row, fundCode);
        if (priceValue !== null) {
          const key = `${date.toISOString()}-${fundCode}`;
          const existing = pricesMap.get(key);
          if (existing) {
            existing.offerPrice = priceValue;
          }
        }
      });
    });

    // Validate and filter complete records
    const prices: FundPriceData[] = [];
    pricesMap.forEach((price, key) => {
      if (price.bidPrice > 0 && price.midPrice > 0 && price.offerPrice > 0) {
        // Validate price relationship
        if (price.bidPrice <= price.midPrice && price.midPrice <= price.offerPrice) {
          prices.push(price);
        } else {
          logger.warn(`Skipping ${key}: Invalid price relationship (bid=${price.bidPrice}, mid=${price.midPrice}, offer=${price.offerPrice})`);
        }
      }
    });

    if (prices.length === 0) {
      throw new Error('No valid price records found in file');
    }

    return prices;
  }

  /**
   * Get date from row (handles various column names)
   */
  private static getDateFromRow(row: any): Date | null {
    const dateStr = this.getField(row, ['Date', 'date', 'DATE', 'Price Date', 'priceDate']);
    if (!dateStr) return null;
    return this.parseDate(dateStr);
  }

  /**
   * Get fund price from row
   */
  private static getFundPriceFromRow(row: any, fundCode: string): number | null {
    const priceStr = this.getField(row, [fundCode, fundCode.toLowerCase(), fundCode.toUpperCase()]);
    if (!priceStr) return null;
    return this.parsePrice(priceStr);
  }

  /**
   * Process parsed rows
   */
  private static processRows(rows: any[]): FundPriceData[] {
    const prices: FundPriceData[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // Account for header

      try {
        const price = this.parseRow(row, rowNumber);
        if (price) {
          prices.push(price);
        }
      } catch (error: any) {
        logger.warn(`Skipping row ${rowNumber}: ${error.message}`);
      }
    }

    if (prices.length === 0) {
      throw new Error('No valid price records found in file');
    }

    return prices;
  }

  /**
   * Parse a single row
   */
  private static parseRow(row: any, _rowNumber: number): FundPriceData | null {
    // Handle different column name variations
    const date = this.getField(row, ['Date', 'date', 'Price Date', 'priceDate', 'PRICE_DATE']);
    const fundCode = this.getField(row, ['Fund Code', 'fundCode', 'FUND_CODE', 'Fund', 'fund']);
    const bidPrice = this.getField(row, ['Bid Price', 'bidPrice', 'BID_PRICE', 'Bid', 'bid']);
    const midPrice = this.getField(row, ['Mid Price', 'midPrice', 'MID_PRICE', 'Mid', 'mid']);
    const offerPrice = this.getField(row, ['Offer Price', 'offerPrice', 'OFFER_PRICE', 'Offer', 'offer']);
    const nav = this.getField(row, ['NAV', 'nav', 'Net Asset Value', 'netAssetValue']);

    // Validate required fields
    if (!date || !fundCode || !bidPrice || !midPrice || !offerPrice) {
      throw new Error('Missing required fields. Required: Date, Fund Code, Bid Price, Mid Price, Offer Price');
    }

    // Parse date
    const priceDate = this.parseDate(date);
    if (!priceDate) {
      throw new Error(`Invalid date format: ${date}`);
    }

    // Parse prices
    const parsedBidPrice = this.parsePrice(bidPrice);
    const parsedMidPrice = this.parsePrice(midPrice);
    const parsedOfferPrice = this.parsePrice(offerPrice);
    const parsedNav = nav ? this.parsePrice(nav) : null;

    if (parsedBidPrice === null || parsedMidPrice === null || parsedOfferPrice === null) {
      throw new Error('Invalid price values');
    }

    // Validate price relationship
    if (parsedBidPrice > parsedMidPrice || parsedMidPrice > parsedOfferPrice) {
      throw new Error('Invalid prices: bidPrice must be <= midPrice <= offerPrice');
    }

    return {
      fundCode: fundCode.trim().toUpperCase(),
      priceDate,
      bidPrice: parsedBidPrice,
      midPrice: parsedMidPrice,
      offerPrice: parsedOfferPrice,
      nav: parsedNav !== null ? parsedNav : undefined,
    };
  }

  /**
   * Get field value with multiple possible column names
   */
  private static getField(row: any, possibleNames: string[]): string | undefined {
    for (const name of possibleNames) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
        return String(row[name]).trim();
      }
    }
    return undefined;
  }

  /**
   * Parse date from various formats
   * Supports: YYYY-MM-DD, DD/MM/YYYY, DD-MMM-YY, DD-MMM-YYYY, etc.
   */
  private static parseDate(dateStr: string): Date | null {
    try {
      // Clean up the string
      const cleaned = dateStr.trim();

      // Try ISO format first (YYYY-MM-DD)
      if (cleaned.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const date = new Date(cleaned + 'T00:00:00Z');
        if (!isNaN(date.getTime())) {
          return date;
        }
      }

      // Try DD/MM/YYYY format
      if (cleaned.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
        const [day, month, year] = cleaned.split('/').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (!isNaN(date.getTime())) {
          return date;
        }
      }

      // Try DD-MMM-YY or DD-MMM-YYYY format (e.g., 15-Dec-25, 15-Dec-2025)
      const monthAbbr = /^(\d{1,2})[-\s](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-\s](\d{2,4})$/i;
      const monthMatch = cleaned.match(monthAbbr);
      if (monthMatch) {
        const day = parseInt(monthMatch[1]);
        const monthStr = monthMatch[2];
        let year = parseInt(monthMatch[3]);

        // Convert 2-digit year to 4-digit (assume 20xx for years 00-99)
        if (year < 100) {
          year += 2000;
        }

        const monthMap: { [key: string]: number } = {
          jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
          jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
        };

        const month = monthMap[monthStr.toLowerCase()];
        if (month !== undefined) {
          const date = new Date(Date.UTC(year, month, day));
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }

      // Try MM-DD-YYYY format with dashes
      if (cleaned.match(/^\d{1,2}-\d{1,2}-\d{4}$/)) {
        const parts = cleaned.split('-').map(Number);
        // Ambiguous: could be MM-DD-YYYY or DD-MM-YYYY
        // Try MM-DD-YYYY first (US format)
        const date1 = new Date(Date.UTC(parts[2], parts[0] - 1, parts[1]));
        if (!isNaN(date1.getTime()) && parts[0] <= 12) {
          return date1;
        }
        // Try DD-MM-YYYY
        const date2 = new Date(Date.UTC(parts[2], parts[1] - 1, parts[0]));
        if (!isNaN(date2.getTime())) {
          return date2;
        }
      }

      // Try parsing as general date (fallback)
      const date = new Date(cleaned);
      if (!isNaN(date.getTime())) {
        // Normalize to UTC midnight
        return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse price value
   */
  private static parsePrice(priceStr: string): number | null {
    try {
      // Remove currency symbols and commas
      const cleaned = priceStr.replace(/[^0-9.-]/g, '');
      const price = parseFloat(cleaned);

      if (isNaN(price) || price < 0) {
        return null;
      }

      return price;
    } catch (error) {
      return null;
    }
  }
}
